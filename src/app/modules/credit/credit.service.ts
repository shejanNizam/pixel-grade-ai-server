import httpStatus from "http-status";
import { ClientSession, Types } from "mongoose";
import { CREDITS_PER_SCAN } from "../../constants";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { CreditInterval, PlanName } from "../plan/plan.interface";
import { Plan } from "../plan/plan.model";
import { Subscription } from "../subscription/subscription.model";
import { SubStatus } from "../subscription/subscription.interface";
import { CreditReason, ICreditLedger } from "./credit.interface";
import { CreditLedger, CreditWallet } from "./credit.model";

/**
 * Every wallet mutation goes through here so no code path can move credits
 * without leaving a ledger row. `balanceAfter` is captured from the same
 * document update that changed the balance, so the two can never disagree.
 */
const recordEntry = async (
  userId: string | Types.ObjectId,
  amount: number,
  reason: CreditReason,
  balanceAfter: number,
  analysisId?: string | Types.ObjectId,
  session?: ClientSession,
  meta?: Record<string, unknown>,
) => {
  const [entry] = await CreditLedger.create(
    [
      {
        user: userId,
        amount,
        reason,
        balanceAfter,
        ...(analysisId ? { analysis: analysisId } : {}),
        ...(meta ? { meta } : {}),
      },
    ],
    session ? { session } : {},
  );
  return entry;
};

/** Mongo's duplicate-key error. The scan/refund uniqueness index turns a
 *  repeated movement into this rather than a second wallet mutation. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * Claim the right to move credits for one analysis, then move them.
 *
 * The ledger row is written BEFORE the wallet changes, which is the opposite of
 * the obvious order and the whole point: `{analysis, reason}` is unique, so the
 * insert is what arbitrates between two callers racing to refund the same scan
 * (a user closing the dialog just as the sweeper reaches it). Whoever loses the
 * insert never touches the wallet, so a scan cannot be refunded twice.
 *
 * `balanceAfter` is filled in immediately after the wallet update. It is briefly
 * wrong on the freshly-written row; that is strictly better than the
 * alternative, where a lost race has already minted credits.
 *
 * Returns null when the movement was already recorded — the caller treats that
 * as success, because the credits are where they should be either way.
 */
const claimAnalysisMovement = async (
  userId: string | Types.ObjectId,
  amount: number,
  reason: CreditReason,
  analysisId: string | Types.ObjectId,
  session?: ClientSession,
  meta?: Record<string, unknown>,
): Promise<ICreditLedger | null> => {
  try {
    const [entry] = await CreditLedger.create(
      [
        {
          user: userId,
          amount,
          reason,
          balanceAfter: 0,
          analysis: analysisId,
          ...(meta ? { meta } : {}),
        },
      ],
      session ? { session } : {},
    );
    return entry ?? null;
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }
};

/** Resolve the user's active plan, falling back to Free when they have no
 *  subscription at all — an unsubscribed account is a Free account. */
const resolvePlan = async (userId: string) => {
  const subscription = await Subscription.findOne({
    user: userId,
    status: SubStatus.active,
  }).populate("plan");

  if (subscription?.plan) {
    return subscription.plan as unknown as InstanceType<typeof Plan>;
  }

  const free = await Plan.findOne({ name: PlanName.Free });
  if (!free) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Free plan is not seeded — run seedPlans.",
    );
  }
  return free;
};

/** Wallets are created lazily on first read so an account that predates this
 *  module still gets one, rather than 404-ing forever. */
const getOrCreateWallet = async (userId: string) => {
  const existing = await CreditWallet.findOne({ user: userId });
  if (existing) return existing;

  const plan = await resolvePlan(userId);
  const isUnlimited = plan.creditAmount === null;

  return CreditWallet.create({
    user: userId,
    balance: isUnlimited ? 0 : (plan.creditAmount ?? 0),
    isUnlimited,
  });
};

const getBalance = async (userId: string) => {
  const wallet = await getOrCreateWallet(userId);
  const plan = await resolvePlan(userId);

  return {
    balance: wallet.isUnlimited ? null : wallet.balance,
    isUnlimited: wallet.isUnlimited,
    creditsPerScan: CREDITS_PER_SCAN,
    scansRemaining: wallet.isUnlimited
      ? null
      : Math.floor(wallet.balance / CREDITS_PER_SCAN),
    allowance: plan.creditAmount,
    interval: plan.creditInterval,
    periodEnd: wallet.periodEnd,
    lastDailyGrantAt: wallet.lastDailyGrantAt,
  };
};

/**
 * Server-authoritative spend. Called only from the scan pipeline — never from a
 * route that a client can reach directly.
 *
 * The debit is a single conditional update rather than a read-then-write: two
 * concurrent scans on a wallet holding 10 credits must not both succeed, and
 * `balance: { $gte: cost }` inside the update makes the check and the decrement
 * one atomic operation.
 *
 * The ledger row is claimed first (see `claimAnalysisMovement`), so one scan can
 * only ever be charged once however many times this is reached for it.
 */
const spendForScan = async (
  userId: string,
  analysisId: string | Types.ObjectId,
  session?: ClientSession,
) => {
  const wallet = await getOrCreateWallet(userId);

  // Unlimited plans still get a ledger row so admin analytics can report
  // consumption per tier, but the balance is untouched. `charged: false` marks
  // it so a later refund knows there is nothing to give back — the user may
  // have downgraded off Enterprise in between.
  const entry = await claimAnalysisMovement(
    userId,
    -CREDITS_PER_SCAN,
    CreditReason.scan,
    analysisId,
    session,
    wallet.isUnlimited ? { charged: false } : undefined,
  );
  if (!entry) {
    return {
      charged: false,
      balance: wallet.isUnlimited ? null : wallet.balance,
    };
  }

  if (wallet.isUnlimited) {
    entry.balanceAfter = wallet.balance;
    await entry.save();
    return { charged: false, balance: null };
  }

  const updated = await CreditWallet.findOneAndUpdate(
    { user: userId, isUnlimited: false, balance: { $gte: CREDITS_PER_SCAN } },
    { $inc: { balance: -CREDITS_PER_SCAN } },
    { returnDocument: "after", ...(session ? { session } : {}) },
  );

  if (!updated) {
    // The claim did not become a debit, so it must not stay in the ledger —
    // otherwise the refund path would later "return" credits never taken.
    await CreditLedger.deleteOne({ _id: entry._id });
    throw new AppError(
      httpStatus.PAYMENT_REQUIRED,
      `Not enough credits. A scan costs ${CREDITS_PER_SCAN} credits and your balance is ${wallet.balance}.`,
    );
  }

  entry.balanceAfter = updated.balance;
  await entry.save();

  return { charged: true, balance: updated.balance };
};

/**
 * Return the credits a scan took, when that scan never produced a report —
 * it failed, or the user abandoned it at the confirmation step.
 *
 * Idempotent by construction (see `claimAnalysisMovement`), because three
 * different paths can reach it for the same scan: the identification error
 * handler, an explicit cancel, and the abandoned-scan sweeper.
 *
 * Refunds are additive rather than a balance reset, so a refund racing with a
 * fresh daily grant cannot erase the grant.
 */
const refundScan = async (
  userId: string,
  analysisId: string | Types.ObjectId,
) => {
  const wallet = await getOrCreateWallet(userId);
  if (wallet.isUnlimited) return { refunded: false, balance: null };

  // Nothing was ever taken for this scan (no debit was recorded, or the wallet
  // was unlimited at the time) — so there is nothing to give back.
  const debit = await CreditLedger.findOne({
    analysis: analysisId,
    reason: CreditReason.scan,
  });
  if (!debit || debit.meta?.charged === false) {
    return { refunded: false, balance: wallet.balance };
  }

  const entry = await claimAnalysisMovement(
    userId,
    CREDITS_PER_SCAN,
    CreditReason.refund,
    analysisId,
  );
  if (!entry) return { refunded: false, balance: wallet.balance };

  const updated = await CreditWallet.findOneAndUpdate(
    { user: userId, isUnlimited: false },
    { $inc: { balance: CREDITS_PER_SCAN } },
    { returnDocument: "after" },
  );
  if (!updated) {
    await CreditLedger.deleteOne({ _id: entry._id });
    throw new AppError(httpStatus.NOT_FOUND, "Wallet not found");
  }

  entry.balanceAfter = updated.balance;
  await entry.save();

  return { refunded: true, balance: updated.balance };
};

/**
 * Grant an interval's allowance. Free is a *reset to* the daily amount (no
 * rollover); paid tiers are also a reset, since the client confirmed monthly
 * allowances do not accumulate. If rollover is later approved this is the one
 * place that changes — see docs/OPEN-QUESTIONS.md.
 */
const grantAllowance = async (userId: string) => {
  const plan = await resolvePlan(userId);
  const wallet = await getOrCreateWallet(userId);

  if (plan.creditAmount === null) {
    await CreditWallet.updateOne(
      { user: userId },
      { isUnlimited: true, balance: 0 },
    );
    return { granted: null, balance: null };
  }

  const isDaily = plan.creditInterval === CreditInterval.daily;
  const delta = plan.creditAmount - wallet.balance;

  const updated = await CreditWallet.findOneAndUpdate(
    { user: userId },
    {
      balance: plan.creditAmount,
      isUnlimited: false,
      ...(isDaily ? { lastDailyGrantAt: new Date() } : {}),
    },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError(httpStatus.NOT_FOUND, "Wallet not found");

  await recordEntry(
    userId,
    delta,
    isDaily ? CreditReason.grant_daily : CreditReason.grant_monthly,
    updated.balance,
  );

  return { granted: plan.creditAmount, balance: updated.balance };
};

/** Admin correction. Always additive and always leaves a ledger row naming the
 *  admin who made it. */
const adminAdjust = async (
  userId: string,
  amount: number,
  adminId: string,
) => {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Adjustment must be a non-zero whole number.",
    );
  }

  await getOrCreateWallet(userId);

  const updated = await CreditWallet.findOneAndUpdate(
    { user: userId },
    { $inc: { balance: amount } },
    { returnDocument: "after" },
  );
  if (!updated) throw new AppError(httpStatus.NOT_FOUND, "Wallet not found");

  // $inc can drive the balance negative; clamp rather than reject, so an admin
  // clawing back more than the user holds leaves them at zero, not in debt.
  if (updated.balance < 0) {
    updated.balance = 0;
    await updated.save();
  }

  await recordEntry(
    userId,
    amount,
    CreditReason.admin_adjust,
    updated.balance,
    undefined,
    undefined,
    { adjustedBy: adminId },
  );

  return { balance: updated.balance };
};

const getLedger = async (userId: string, query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<ICreditLedger>(
    CreditLedger.find({ user: userId }),
    query,
  );

  const entries = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: entries, meta };
};

export const CreditServices = {
  getOrCreateWallet,
  getBalance,
  spendForScan,
  refundScan,
  grantAllowance,
  adminAdjust,
  getLedger,
  resolvePlan,
};
