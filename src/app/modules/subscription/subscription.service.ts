import httpStatus from "http-status";
import { PipelineStage, Types } from "mongoose";
import Stripe from "stripe";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { getStripe } from "../../services/stripe.service";
import { startOfMonth } from "../../utils/dateWindows";
import { logger } from "../../utils/logger";
import { CreditServices } from "../credit/credit.service";
import { NotifType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
import { PlanName } from "../plan/plan.interface";
import { Plan } from "../plan/plan.model";
import { SlabOrder } from "../slabOrder/slabOrder.model";
import { TxnStatus, TxnType } from "../transaction/transaction.interface";
import { Transaction } from "../transaction/transaction.model";
import { User } from "../user/user.model";
import { BillingInterval, SubStatus } from "./subscription.interface";
import { Subscription } from "./subscription.model";

/**
 * What Stripe charges up front.
 *
 * Yearly is the *effective monthly* rate × 12, charged on day one — the client
 * confirmed this. It is deliberately not `priceMonthly × 12`; the discount is
 * already baked into `priceYearly`, and multiplying the wrong field is the
 * easiest way to silently overcharge every yearly customer.
 */
const amountFor = (
  plan: { priceMonthly: number; priceYearly: number },
  interval: BillingInterval,
): number =>
  interval === BillingInterval.yearly
    ? plan.priceYearly * 12
    : plan.priceMonthly;

/** Where the user lands after Stripe. */
const returnUrls = () => ({
  success_url: `${configs.frontend_url}/user-dashboard/subscription?checkout=success`,
  cancel_url: `${configs.frontend_url}/user-dashboard/subscription?checkout=cancelled`,
});

/**
 * Starts a checkout session.
 *
 * Free is rejected: it is the implicit default for any account without an
 * active paid subscription, so "subscribing" to it would create a Stripe
 * customer and a $0 subscription for nothing.
 */
const createCheckoutSession = async (
  userId: string,
  planId: string,
  interval: BillingInterval,
) => {
  const plan = await Plan.findById(planId);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, "Plan not found");
  if (plan.name === PlanName.Free) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "The Free plan is the default and does not require checkout.",
    );
  }

  const priceId =
    interval === BillingInterval.yearly
      ? plan.stripePriceIdYear
      : plan.stripePriceIdMonth;
  if (!priceId) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      `This plan has no Stripe price configured for ${interval} billing.`,
    );
  }

  const user = await User.findById(userId);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      // The webhook is the only place a subscription is actually activated, and
      // it needs to know who and what — the client never gets to assert either.
      metadata: {
        userId: String(user._id),
        planId: String(plan._id),
        interval,
      },
      ...returnUrls(),
    });
  } catch (stripeErr: unknown) {
    logger.error("Stripe checkout session creation failed:", stripeErr);
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Payment checkout is temporarily unavailable. Please try again shortly or contact support.",
    );
  }

  return { checkoutUrl: session.url, sessionId: session.id };
};

/**
 * Activates or updates a subscription from a verified Stripe event.
 *
 * Only ever called from the webhook, never from a client route — a user who
 * could call this directly could grant themselves Enterprise.
 */
const activateFromWebhook = async (
  userId: string,
  planId: string,
  interval: BillingInterval,
  /** Absent for a manual (no-Stripe) grant — see scripts/grant-plan.ts. A
   *  subscription without this id cannot be cancelled through Stripe. */
  stripeSubscriptionId?: string,
  currentPeriodEnd?: Date,
) => {
  const plan = await Plan.findById(planId);
  if (!plan) {
    logger.error("Webhook referenced an unknown plan", { planId, userId });
    return null;
  }

  const subscription = await Subscription.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      plan: planId,
      interval,
      status: SubStatus.active,
      // Only overwrite the Stripe id when one is supplied, so a manual re-grant
      // never wipes a real subscription reference.
      ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    },
    { returnDocument: "after", upsert: true, runValidators: true },
  );

  await Transaction.create({
    user: userId,
    type: TxnType.subscription,
    subscription: subscription?._id,
    plan: planId,
    amount: amountFor(plan, interval),
    currency: "USD",
    status: TxnStatus.succeeded,
    stripeRef: stripeSubscriptionId ?? "manual-grant",
  });

  // Grant the new allowance immediately. On a yearly plan this grants ONE
  // month's credits — the monthly cron grants the rest, month by month.
  await CreditServices.grantAllowance(userId);

  await NotificationServices.create(
    userId,
    NotifType.subscription,
    `Your ${plan.name} plan is active`,
    interval === BillingInterval.yearly
      ? `Billed yearly. Your ${plan.creditAmount ?? "unlimited"} credits refresh every month.`
      : `Billed monthly.`,
    "/user-dashboard/subscription",
  );

  // Revenue event — staff see conversions as they happen rather than only in
  // the monthly figures.
  await NotificationServices.createForStaff(
    NotifType.subscription_started,
    `New ${plan.name} subscription`,
    `Billed ${interval}.`,
    "/admin/subscribed-users",
  );

  return subscription;
};

const markPastDue = async (stripeSubscriptionId: string) => {
  const subscription = await Subscription.findOneAndUpdate(
    { stripeSubscriptionId },
    { status: SubStatus.past_due },
    { returnDocument: "after" },
  );
  if (!subscription) return null;

  await NotificationServices.create(
    subscription.user,
    NotifType.subscription,
    "Payment failed",
    "We could not process your subscription payment. Update your payment method to keep your plan active.",
    "/user-dashboard/subscription",
  );

  // Churn signal — worth a staff alert while the account can still be saved.
  await NotificationServices.createForStaff(
    NotifType.subscription_payment_failed,
    "A subscription payment failed",
    "The account is past due and may lapse.",
    "/admin/subscribed-users",
  );

  return subscription;
};

const markCanceled = async (stripeSubscriptionId: string) => {
  return Subscription.findOneAndUpdate(
    { stripeSubscriptionId },
    { status: SubStatus.canceled },
    { returnDocument: "after" },
  );
};

/**
 * Handles a verified Stripe event.
 *
 * Unrecognised event types return quietly rather than throwing: Stripe retries
 * on a non-2xx, so throwing on an event we simply do not care about would
 * produce an endless retry loop.
 */
const handleWebhookEvent = async (event: Stripe.Event) => {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const { userId, planId, interval } = session.metadata ?? {};
      if (!userId || !planId || !interval) {
        logger.error("Checkout session completed without metadata", {
          sessionId: session.id,
        });
        return { handled: false };
      }
      await activateFromWebhook(
        userId,
        planId,
        interval as BillingInterval,
        String(session.subscription),
      );
      return { handled: true };
    }

    case "invoice.payment_succeeded": {
      // Renewal. Extends the period and re-grants the allowance.
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string;
      };
      if (!invoice.subscription) return { handled: false };

      const subscription = await Subscription.findOne({
        stripeSubscriptionId: String(invoice.subscription),
      });
      if (!subscription) return { handled: false };

      subscription.status = SubStatus.active;
      if (invoice.period_end) {
        subscription.currentPeriodEnd = new Date(invoice.period_end * 1000);
      }
      await subscription.save();
      await CreditServices.grantAllowance(String(subscription.user));

      return { handled: true };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice & {
        subscription?: string;
      };
      if (invoice.subscription) {
        await markPastDue(String(invoice.subscription));
      }
      return { handled: true };
    }

    case "customer.subscription.deleted": {
      await markCanceled(String(event.data.object.id));
      return { handled: true };
    }

    default:
      return { handled: false };
  }
};

/**
 * Cancels at period end rather than immediately — the user paid through the
 * current period and keeps access until it lapses.
 */
const cancelSubscription = async (userId: string) => {
  const subscription = await Subscription.findOne({
    user: userId,
    status: SubStatus.active,
  });
  if (!subscription?.stripeSubscriptionId) {
    throw new AppError(httpStatus.NOT_FOUND, "No active subscription found");
  }

  await getStripe().subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  subscription.cancelAtPeriodEnd = true;
  await subscription.save();

  return subscription;
};

/** The user's plan, renewal date, and credit position in one call. */
const getMySubscription = async (userId: string) => {
  const subscription = await Subscription.findOne({ user: userId }).populate(
    "plan",
  );
  const plan = await CreditServices.resolvePlan(userId);
  const credits = await CreditServices.getBalance(userId);

  return { subscription, plan, credits };
};

/**
 * Admin list of subscribers.
 *
 * Driven from Subscription rather than User because "subscribed" is a fact
 * about a subscription, not a column on the account — filtering `User` could
 * never express it. The user and plan are joined in so the table has a name,
 * an email, and a tier without a second round trip.
 *
 * NOTE: the admin table also has Country and State columns. Neither exists on
 * the user model, so neither is returned — see docs/OPEN-QUESTIONS.md before
 * adding them, since collecting location is a data-protection decision rather
 * than a schema one.
 */
const listSubscribers = async (query: Record<string, string>) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  const searchTerm = (query.searchTerm ?? "").trim();

  const match: Record<string, unknown> = {};
  // Default to active: an admin opening "Subscribed users" means people who are
  // paying now, not everyone who ever did.
  match.status = query.status
    ? query.status
    : { $in: [SubStatus.active, SubStatus.past_due] };
  // Cast explicitly: the joined `plan._id` is an ObjectId, and $match does not
  // coerce a string to one, so an uncast filter silently returns nothing.
  if (query.plan && Types.ObjectId.isValid(query.plan)) {
    match["plan._id"] = new Types.ObjectId(query.plan);
  }

  const pipeline: PipelineStage[] = [
    {
      $lookup: {
        from: User.collection.name,
        localField: "user",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    { $match: { "user.isDeleted": false } },
    {
      $lookup: {
        from: Plan.collection.name,
        localField: "plan",
        foreignField: "_id",
        as: "plan",
      },
    },
    { $unwind: "$plan" },
    { $match: match },
  ];

  if (searchTerm) {
    const rx = new RegExp(searchTerm, "i");
    pipeline.push({
      $match: { $or: [{ "user.name": rx }, { "user.email": rx }] },
    });
  }

  pipeline.push({
    $project: {
      _id: 1,
      status: 1,
      interval: 1,
      currentPeriodEnd: 1,
      cancelAtPeriodEnd: 1,
      subscribedAt: "$createdAt",
      "user._id": 1,
      "user.name": 1,
      "user.email": 1,
      "user.status": 1,
      "user.avatar": 1,
      "user.createdAt": 1,
      "plan._id": 1,
      "plan.name": 1,
      "plan.priceMonthly": 1,
      "plan.priceYearly": 1,
    },
  });

  // $facet keeps the page and its total in one round trip.
  const [result] = await Subscription.aggregate([
    ...pipeline,
    {
      $facet: {
        data: [
          { $sort: { subscribedAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        total: [{ $count: "count" }],
      },
    },
  ]);

  const total = result?.total?.[0]?.count ?? 0;

  return {
    data: result?.data ?? [],
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

/**
 * Subscriber counts and monthly recurring revenue.
 *
 * MRR takes `priceYearly` verbatim for yearly subscribers because that field is
 * ALREADY the effective monthly rate — the ×12 happens once, at checkout (see
 * `amountFor`). Dividing an annual charge by twelve here would double-discount
 * every yearly customer and quietly understate MRR.
 *
 * `past_due` counts toward neither: the subscription has not been cancelled,
 * but the money did not arrive, and reporting it as recurring revenue would
 * book income that failed to collect.
 */
const getSubscriberStats = async () => {
  const rows = await Subscription.aggregate<{
    _id: null;
    activeSubscriptions: number;
    mrr: number;
    newThisMonth: number;
    newLastMonth: number;
  }>([
    { $match: { status: SubStatus.active } },
    {
      $lookup: {
        from: Plan.collection.name,
        localField: "plan",
        foreignField: "_id",
        as: "plan",
      },
    },
    { $unwind: "$plan" },
    {
      $group: {
        _id: null,
        activeSubscriptions: { $sum: 1 },
        mrr: {
          $sum: {
            $cond: [
              { $eq: ["$interval", BillingInterval.yearly] },
              "$plan.priceYearly",
              "$plan.priceMonthly",
            ],
          },
        },
        newThisMonth: {
          $sum: {
            $cond: [{ $gte: ["$createdAt", startOfMonth(0)] }, 1, 0],
          },
        },
        newLastMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$createdAt", startOfMonth(1)] },
                  { $lt: ["$createdAt", startOfMonth(0)] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const stats = rows[0];

  const slabRevenueAgg = await SlabOrder.aggregate<{
    _id: null;
    total: number;
  }>([
    { $match: { paymentStatus: { $ne: "failed" } } },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } },
  ]);
  const slabRevenue = slabRevenueAgg[0]?.total ?? 0;

  return {
    activeSubscriptions: stats?.activeSubscriptions ?? 0,
    mrr: Number((stats?.mrr ?? 0).toFixed(2)),
    slabRevenue: Number((slabRevenue ?? 0).toFixed(2)),
    newThisMonth: stats?.newThisMonth ?? 0,
    newLastMonth: stats?.newLastMonth ?? 0,
  };
};

export const SubscriptionServices = {
  createCheckoutSession,
  listSubscribers,
  getSubscriberStats,
  handleWebhookEvent,
  activateFromWebhook,
  cancelSubscription,
  getMySubscription,
  amountFor,
};
