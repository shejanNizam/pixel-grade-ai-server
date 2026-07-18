import { FREE_DAILY_CREDITS } from "../constants";
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
    creditAmount: 6000,
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
    // null = unlimited
    creditAmount: null,
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

/**
 * Inserts any missing tier. Deliberately does NOT overwrite an existing plan —
 * admins edit prices and features through the panel, and a redeploy must not
 * silently revert their changes back to these defaults.
 */
export const seedPlans = async () => {
  try {
    for (const plan of planCatalog) {
      const exists = await Plan.findOne({ name: plan.name });
      if (exists) continue;

      await Plan.create(plan);
      logger.info(`Seeded plan: ${plan.name}`);
    }
  } catch (error) {
    logger.error("Failed to seed plans", { error });
  }
};
