import { CREDITS_PER_SCAN, FREE_DAILY_CREDITS } from "../constants";
import {
  CreditInterval,
  IPlanInitial,
  PlanName,
} from "../modules/plan/plan.interface";
import { Plan } from "../modules/plan/plan.model";
import { logger } from "./logger";

/**
 * The four fixed tiers. Mirrors `pixel-grade-ai/src/config/plans.ts` — if you
 * change prices, credits, or features here, change them there too.
 *
 * `priceYearly` is the *effective monthly* rate on a yearly subscription; the
 * customer is charged that × 12 up front. Credits still refresh monthly.
 *
 * ⚠️ `creditAmount` is in CREDITS, but the client specifies plans in SCANS
 * (2026-08-10: Free 5/day, Collector 300/month, Pro 1,200/month, Enterprise
 * unlimited). Multiply by CREDITS_PER_SCAN. Pasting the scan count in here
 * fails silently — the plan still works, it just sells a fifth of what was
 * advertised.
 */
const planCatalog: IPlanInitial[] = [
  {
    name: PlanName.Free,
    tagline: "For trying it out",
    priceMonthly: 0,
    priceYearly: 0,
    creditAmount: FREE_DAILY_CREDITS,
    creditInterval: CreditInterval.daily,
    pixelscope: false,
    priceTracking: false,
    watermarkReports: true,
    features: [
      "Standard scan (phone camera)",
      "Basic AI grading report",
      "Order custom slab labels",
      "No PixelScope",
      "No Pixel Verified badge",
    ],
    isActive: true,
  },
  {
    name: PlanName.Collector,
    tagline: "For active collectors",
    priceMonthly: 10,
    priceYearly: 8,
    creditAmount: 1500,
    creditInterval: CreditInterval.monthly,
    pixelscope: true,
    priceTracking: true,
    watermarkReports: false,
    features: [
      "Standard & Advanced (PixelScope) scans",
      "Pixel Verified badge",
      "Full AI grading reports",
      "Unlimited report history",
      "Collection management",
      "Price tracking",
      "Order custom slab labels",
    ],
    isActive: true,
  },
  {
    name: PlanName.Pro,
    tagline: "For power users",
    priceMonthly: 25,
    priceYearly: 20,
    creditAmount: 4000,
    creditInterval: CreditInterval.monthly,
    pixelscope: true,
    priceTracking: true,
    watermarkReports: false,
    features: [
      "Everything in Collector",
      "Priority AI processing",
      "Bulk grading",
      "Advanced analytics",
      "Collection insights",
      "Early access to new AI features",
      "Priority support",
    ],
    isActive: true,
  },
  {
    name: PlanName.Enterprise,
    tagline: "For businesses & card shops",
    priceMonthly: 119,
    priceYearly: 99,
    creditAmount: 25000,
    creditInterval: CreditInterval.monthly,
    pixelscope: true,
    priceTracking: true,
    watermarkReports: false,
    features: [
      "Everything in Pro",
      "Custom grading reports",
      "Team accounts",
      "Card Shop Dashboard",
      "API access (coming soon)",
      "Dedicated account manager",
      "Priority feature requests",
    ],
    isActive: true,
  },
];

import { User } from "../modules/user/user.model";
import { Subscription } from "../modules/subscription/subscription.model";
import { BillingInterval, SubStatus } from "../modules/subscription/subscription.interface";

export const grantAdminEnterpriseAccess = async () => {
  try {
    const adminEmails = ["admin@pixelgradeai.com", "superadmin@pixelgradeai.com"];
    const enterprisePlan = await Plan.findOne({ name: PlanName.Enterprise });
    if (!enterprisePlan) return;

    for (const email of adminEmails) {
      const user = await User.findOne({ email });
      if (user) {
        const existingSub = await Subscription.findOne({ user: user._id });
        if (existingSub) {
          existingSub.plan = enterprisePlan._id;
          existingSub.status = SubStatus.active;
          await existingSub.save();
        } else {
          await Subscription.create({
            user: user._id,
            plan: enterprisePlan._id,
            status: SubStatus.active,
            interval: BillingInterval.yearly,
            currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          });
        }
        logger.info(`Granted Enterprise access to admin: ${email}`);
      }
    }
  } catch (error) {
    logger.error("Failed to grant admin enterprise access", { error });
  }
};

/**
 * Inserts any missing tier and grants admin Enterprise access.
 */
export const seedPlans = async () => {
  try {
    for (const plan of planCatalog) {
      const exists = await Plan.findOne({ name: plan.name });
      if (exists) {
        if (exists.creditAmount !== plan.creditAmount) {
          exists.creditAmount = plan.creditAmount;
          await exists.save();
          logger.info(`Updated creditAmount for plan: ${plan.name}`);
        }
        continue;
      }

      await Plan.create(plan);
      logger.info(`Seeded plan: ${plan.name}`);
    }

    await grantAdminEnterpriseAccess();
  } catch (error) {
    logger.error("Failed to seed plans", { error });
  }
};
