import cron from "node-cron";
import { FREE_DAILY_CREDITS } from "../constants";
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
 * ⚠️ SINGLE-INSTANCE ASSUMPTION. node-cron fires in every process that runs it,
 * so on a multi-instance deploy each replica would grant credits independently
 * and users would receive N× their allowance. Before scaling past one instance,
 * either gate these behind a Redis lock or move them to an external scheduler.
 * `grantAllowance` is a reset rather than an increment, which limits the damage,
 * but the ledger would still show duplicate grant rows.
 */

/** Hourly price refresh, oldest-priced cards first. */
const startPriceRefresh = () =>
  cron.schedule("0 * * * *", async () => {
    try {
      const result = await PriceServices.refreshStalest(500);
      if (!result.skipped) {
        logger.info("Price refresh complete", result);
        await ActivityLogServices.record(ActivityAction.price_refresh, {
          meta: result,
        });
      }
    } catch (error) {
      logger.error("Price refresh job failed", { error });
    }
  });

/**
 * Daily Free-plan top-up, 00:05.
 *
 * `lastDailyGrantAt` guards the reset so a restart, a redeploy, or a manual
 * re-run on the same day cannot double-grant. Free credits do not roll over —
 * the grant is a reset to the daily amount, not an addition.
 */
const startDailyCreditGrant = () =>
  cron.schedule("5 0 * * *", async () => {
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
          const plan = await CreditServices.resolvePlan(String(wallet.user));
          // Only Free tops up daily; paid tiers are handled by the monthly job.
          if (plan.creditInterval !== CreditInterval.daily) continue;

          await CreditServices.grantAllowance(String(wallet.user));
          granted += 1;
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
  });

/**
 * Monthly paid-plan refresh, 1st of the month at 00:10.
 *
 * This is what makes yearly billing work correctly: a yearly Collector was
 * charged for twelve months up front but receives 1,500 credits *each month*,
 * not 18,000 on day one. The subscription's billing interval is irrelevant
 * here — the plan's credit interval is what drives the grant.
 */
const startMonthlyCreditGrant = () =>
  cron.schedule("10 0 1 * *", async () => {
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
  });

export const startJobs = () => {
  startPriceRefresh();
  startDailyCreditGrant();
  startMonthlyCreditGrant();
  logger.info("Scheduled jobs started (price refresh, daily/monthly credits)");
};
