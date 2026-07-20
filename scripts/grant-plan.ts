/**
 * Dev tool: manually put a user on a paid plan WITHOUT Stripe.
 *
 * Runs the exact same activation path as the Stripe webhook — it upserts an
 * active subscription, GRANTS THE PLAN'S CREDITS, and files a notification —
 * so the credit wallet stays correct. It just skips the payment.
 *
 * Usage (from pixel-grade-ai-server/):
 *   npx tsx --env-file=.env scripts/grant-plan.ts <email> <Plan> [monthly|yearly]
 *
 * Examples:
 *   npx tsx --env-file=.env scripts/grant-plan.ts nizam.ilmify@gmail.com Pro
 *   npx tsx --env-file=.env scripts/grant-plan.ts user@x.com Collector yearly
 *
 * Notes:
 *  - Plan is Collector | Pro | Enterprise (Free needs no subscription).
 *  - The subscription has no Stripe id, so it can't be cancelled via the UI's
 *    cancel button — re-run this with a different plan, or grant Collector then
 *    manage from there. Intended for development only.
 */
import mongoose from "mongoose";
import { BillingInterval } from "../src/app/modules/subscription/subscription.interface";
import { Plan } from "../src/app/modules/plan/plan.model";
import { PlanName } from "../src/app/modules/plan/plan.interface";
import { SubscriptionServices } from "../src/app/modules/subscription/subscription.service";
import { User } from "../src/app/modules/user/user.model";

const [email, planName, intervalArg = "monthly"] = process.argv.slice(2);

if (!email || !planName) {
  console.error(
    "Usage: tsx --env-file=.env scripts/grant-plan.ts <email> <Collector|Pro|Enterprise> [monthly|yearly]",
  );
  process.exit(1);
}

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL is missing.");

const interval =
  intervalArg === "yearly" ? BillingInterval.yearly : BillingInterval.monthly;

async function main() {
  await mongoose.connect(DATABASE_URL!);

  const user = await User.findOne({ email, isDeleted: false });
  if (!user) throw new Error(`No active user with email "${email}".`);

  if (planName === PlanName.Free) {
    throw new Error("Free is the default plan and needs no subscription.");
  }
  const plan = await Plan.findOne({ name: planName });
  if (!plan) {
    throw new Error(
      `No plan named "${planName}". Use Collector, Pro, or Enterprise.`,
    );
  }

  // Give the subscription a realistic renewal date for the dashboard.
  const periodEnd = new Date();
  if (interval === BillingInterval.yearly) {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  await SubscriptionServices.activateFromWebhook(
    String(user._id),
    String(plan._id),
    interval,
    undefined, // no Stripe subscription — this is a manual grant
    periodEnd,
  );

  console.log(
    `Granted ${plan.name} (${interval}) to ${email}. Credits: ${
      plan.creditAmount ?? "unlimited"
    } / ${plan.creditInterval}. Renews ${periodEnd.toDateString()}.`,
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
