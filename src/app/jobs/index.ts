import cron from "node-cron";
import { withCronLock } from "../utils/cronLock";
import {
  ABANDONED_SCAN_TIMEOUT_MINUTES,
  FREE_DAILY_CREDITS,
} from "../constants";
import { AnalysisServices } from "../modules/analysis/analysis.service";
import { CreditWallet } from "../modules/credit/credit.model";
import { CreditServices } from "../modules/credit/credit.service";
import { CreditInterval } from "../modules/plan/plan.interface";
import { PriceServices } from "../modules/price/price.service";
import { ActivityAction } from "../modules/activity_log/activity_log.interface";
import { ActivityLogServices } from "../modules/activity_log/activity_log.service";
import { logger } from "../utils/logger";

/**
 * Scheduled jobs.
 *
 * node-cron fires in every process that runs it, so on a multi-instance deploy
 * each replica would otherwise grant credits independently and users would
 * receive N× their allowance. Every job below is therefore wrapped in
 * `withCronLock`, a Redis lease: the first replica to claim the name runs the
 * pass and the rest return immediately. Add the lock in the same change as any
 * new job — the lease is the only thing standing between a second replica and
 * duplicate grant rows in the ledger.
 *
 * ⚠️ These schedules are wall-clock deadlines, not timers that catch up. A
 * process that is suspended (a sleeping dev machine, a paused container) wakes
 * to find the slots it missed already past, and node-cron reports them as
 * "missed execution ... possible blocking IO or high CPU" — a guess that is
 * usually wrong. Several warnings sharing one millisecond mean the clock jumped,
 * not that the event loop stalled. Nothing here needs to be caught up by hand:
 * the sweep is an age query and the grants are claim-based, so the next pass
 * settles whatever the missed one would have.
 */

/**
 * Daily price refresh at 00:30, held/tracked cards first.
 *
 * Daily cadence and the batch size are Scrydex budget decisions. Quotes cost 1
 * Scrydex credit each, drawn from the same monthly pool that funds
 * identification at 5 credits per scan, so this constant and scan capacity are
 * in direct competition.
 *
 * Growth tier (client, 2026-07-30) — 50,000 credits/month:
 *   1,000 cards/day × 30 = 30,000 credits, leaving ~20,000 ≈ 4,000 scans/month.
 * That is the same 60/40 pricing-to-scans split the client accepted on Starter
 * (which was 100/day = 3,000, leaving ~400 scans), scaled to the larger pool.
 *
 * The limit is a CEILING, not a fixed spend: `refreshStalest` quotes at most
 * this many cards and simply runs out when the catalogue is smaller, so a
 * generous value costs nothing until there is a catalogue big enough to use it.
 *
 * ⚠️ Do NOT restore the requirements' "hourly recommended" cadence on Growth,
 * despite what the earlier note here said. Hourly is 720 credits per card per
 * month, so the whole 50,000 pool buys hourly quotes for ~69 cards and leaves
 * nothing for scans. Hourly needs Professional at minimum, and a catalogue in
 * the hundreds makes it expensive even there.
 *
 * Raising the FREQUENCY is not a free way to get fresher prices either:
 * `refreshStalest` has no staleness floor, so a second daily pass re-quotes the
 * same cards and simply doubles the spend on any catalogue smaller than the
 * batch. Add a floor there before adding a pass here.
 */
const DAILY_PRICE_BATCH = 1000;

const startPriceRefresh = () =>
  cron.schedule("30 0 * * *", () =>
    withCronLock("price-refresh", 60 * 30, async () => {
    try {
      const result = await PriceServices.refreshStalest(DAILY_PRICE_BATCH);
      if (!result.skipped) {
        logger.info("Price refresh complete", result);
        await ActivityLogServices.record(ActivityAction.price_refresh, {
          meta: result,
        });
      }
    } catch (error) {
      logger.error("Price refresh job failed", { error });
    }
    }),
  );

/**
 * Daily Free-plan top-up, 00:05.
 *
 * This is a BACKSTOP, not the primary path. `CreditServices.ensureDailyAllowance`
 * runs on every balance read and every scan, so an active user's allowance is
 * settled by the calendar rather than by whether this process happened to be
 * alive at 00:05. The sweep exists so dormant wallets still tick over and so
 * the activity log gets a daily marker.
 *
 * Both paths share the same atomic `lastDailyGrantAt` claim, so the cron
 * racing a user's own request cannot double-grant. Free credits do not roll
 * over — the grant is a reset to the daily amount, not an addition.
 */
const startDailyCreditGrant = () =>
  cron.schedule("5 0 * * *", () =>
    withCronLock("daily-credit-grant", 60 * 30, async () => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const wallets = await CreditWallet.find({
        isUnlimited: false,
        $or: [
          { lastDailyGrantAt: { $exists: false } },
          { lastDailyGrantAt: { $lt: startOfDay } },
        ],
      }).select("user");

      let granted = 0;
      for (const wallet of wallets) {
        try {
          // Plan filtering and the double-grant guard both live inside
          // ensureDailyAllowance — the cron must not reimplement either.
          const result = await CreditServices.ensureDailyAllowance(
            String(wallet.user),
          );
          if (result.granted) granted += 1;
        } catch (error) {
          logger.error("Daily credit grant failed for user", {
            userId: String(wallet.user),
            error,
          });
        }
      }

      logger.info("Daily credit grant complete", {
        granted,
        amount: FREE_DAILY_CREDITS,
      });
      await ActivityLogServices.record(ActivityAction.credit_grant, {
        meta: { interval: "daily", granted },
      });
    } catch (error) {
      logger.error("Daily credit grant job failed", { error });
    }
    }),
  );

/**
 * Monthly paid-plan refresh, 1st of the month at 00:10.
 *
 * This is what makes yearly billing work correctly: a yearly Collector was
 * charged for twelve months up front but receives 1,500 credits *each month*,
 * not 18,000 on day one. The subscription's billing interval is irrelevant
 * here — the plan's credit interval is what drives the grant.
 */
const startMonthlyCreditGrant = () =>
  cron.schedule("10 0 1 * *", () =>
    withCronLock("monthly-credit-grant", 60 * 30, async () => {
    try {
      const wallets = await CreditWallet.find().select("user");

      let granted = 0;
      for (const wallet of wallets) {
        try {
          const plan = await CreditServices.resolvePlan(String(wallet.user));
          if (plan.creditInterval !== CreditInterval.monthly) continue;

          await CreditServices.grantAllowance(String(wallet.user));
          granted += 1;
        } catch (error) {
          logger.error("Monthly credit grant failed for user", {
            userId: String(wallet.user),
            error,
          });
        }
      }

      logger.info("Monthly credit grant complete", { granted });
      await ActivityLogServices.record(ActivityAction.credit_grant, {
        meta: { interval: "monthly", granted },
      });
    } catch (error) {
      logger.error("Monthly credit grant job failed", { error });
    }
    }),
  );

/**
 * Abandoned-scan refunds, every 10 minutes.
 *
 * A scan debits up-front because that is what pays for the vendor's
 * identification call, but the rule the credits actually express is "10 credits
 * per finished report". The cancel endpoint covers the user who closes the
 * dialog; this covers everyone whose browser never got the chance to send it —
 * a closed tab, a crash, a dropped connection.
 *
 * Runs often and cheaply: the query is an indexed status+age lookup that
 * matches nothing on most passes.
 */
const startAbandonedScanSweep = () =>
  cron.schedule("*/10 * * * *", () =>
    withCronLock("abandoned-scan-sweep", 60 * 9, async () => {
      try {
        const result = await AnalysisServices.sweepAbandonedScans(
          ABANDONED_SCAN_TIMEOUT_MINUTES,
        );
        if (result.refunded > 0) {
          logger.info("Abandoned scans refunded", result);
        }
      } catch (error) {
        logger.error("Abandoned scan sweep failed", { error });
      }
    }),
  );

export const startJobs = () => {
  startPriceRefresh();
  startDailyCreditGrant();
  startMonthlyCreditGrant();
  startAbandonedScanSweep();
  logger.info(
    "Scheduled jobs started (daily price refresh, daily/monthly credits, abandoned-scan sweep)",
  );
};
