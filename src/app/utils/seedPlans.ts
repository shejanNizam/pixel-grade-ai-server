import { CREDITS_PER_SCAN, FREE_MONTHLY_CREDITS } from "../constants";
import {
  CreditInterval,
  IPlanInitial,
  PlanName,
} from "../modules/plan/plan.interface";
import { Plan } from "../modules/plan/plan.model";
import { logger } from "./logger";

/**
 * The 3 active tiers (Free, Pro, Enterprise) plus deprecated Collector tier.
 * Mirrors `pixel-grade-ai/src/config/plans.ts`.
 */
const planCatalog: IPlanInitial[] = [
  {
    name: PlanName.Free,
    tagline: "For trying it out",
    priceMonthly: 0,
    priceYearly: 0,
    creditAmount: FREE_MONTHLY_CREDITS,
    creditInterval: CreditInterval.monthly,
    pixelscope: false,
    priceTracking: true,
    watermarkReports: true,
    features: [
      "AI grading",
      "Full grading reports",
      "Label generator",
      "Collection management",
      "Price tracking",
    ],
    isActive: true,
  },
  {
    name: PlanName.Collector,
    tagline: "For active collectors (Deprecated)",
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
    isActive: false, // Deprecated per client feedback
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
      "Everything in Free",
      "Priority AI processing",
      "Advanced analytics",
      "Collection insights",
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
      "Priority support",
      "Card Shop Dashboard (Coming Soon)",
      "Team Accounts (Coming Soon)",
      "API Access (Coming Soon)",
    ],
    isActive: true,
  },
];

import { User } from "../modules/user/user.model";
import { Subscription } from "../modules/subscription/subscription.model";
import { BillingInterval, SubStatus } from "../modules/subscription/subscription.interface";
import { CreditServices } from "../modules/credit/credit.service";

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
 * Inserts any missing tier, synchronizes updated plan definitions, and grants admin Enterprise access.
 */
export const seedPlans = async () => {
  try {
    for (const plan of planCatalog) {
      const exists = await Plan.findOne({ name: plan.name });
      if (exists) {
        let changed = false;
        if (exists.creditAmount !== plan.creditAmount) {
          exists.creditAmount = plan.creditAmount;
          changed = true;
        }
        if (exists.creditInterval !== plan.creditInterval) {
          exists.creditInterval = plan.creditInterval;
          changed = true;
        }
        if (exists.isActive !== plan.isActive) {
          exists.isActive = plan.isActive;
          changed = true;
        }
        if (JSON.stringify(exists.features) !== JSON.stringify(plan.features)) {
          exists.features = plan.features;
          changed = true;
        }
        if (changed) {
          await exists.save();
          logger.info(`Updated plan details for: ${plan.name}`);
        }
        continue;
      }

      await Plan.create(plan);
      logger.info(`Seeded plan: ${plan.name}`);
    }

    await grantAdminEnterpriseAccess();
    await CreditServices.migrateLegacyFreeWallets();
  } catch (error) {
    logger.error("Failed to seed plans", { error });
  }
};
