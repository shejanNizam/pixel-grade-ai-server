/**
 * Dev setup: create Stripe TEST-mode products + prices for the paid plans and
 * attach their ids to the plan documents.
 *
 * Run once (from pixel-grade-ai-server/):
 *   npx tsx --env-file=.env scripts/setup-stripe-prices.ts
 *
 * Idempotent: a plan that already has a monthly price id is skipped. Uses the
 * STRIPE_SECRET_KEY and DATABASE_URL already in .env. Stripe test mode only —
 * no real charges are created.
 */
import mongoose from "mongoose";
import Stripe from "stripe";

const { STRIPE_SECRET_KEY, DATABASE_URL } = process.env;

if (!STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error(
    "Refusing to run: STRIPE_SECRET_KEY is missing or is not a test key (sk_test_...).",
  );
}
if (!DATABASE_URL) throw new Error("DATABASE_URL is missing.");

const stripe = new Stripe(STRIPE_SECRET_KEY);

/** Charge = effective monthly rate for month, and that rate × 12 for year —
 *  matching amountFor() in subscription.service.ts. */
const PAID_PLANS = ["Collector", "Pro", "Enterprise"] as const;

async function main() {
  await mongoose.connect(DATABASE_URL!);
  const plans = mongoose.connection.db!.collection("plans");

  for (const name of PAID_PLANS) {
    const plan = await plans.findOne({ name });
    if (!plan) {
      console.log(`- ${name}: no plan document found, skipping`);
      continue;
    }
    if (plan.stripePriceIdMonth) {
      console.log(`- ${name}: already configured, skipping`);
      continue;
    }

    const product = await stripe.products.create({
      name: `PixelGrade ${name}`,
      metadata: { planId: String(plan._id) },
    });

    const monthly = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: Math.round(Number(plan.priceMonthly) * 100),
      recurring: { interval: "month" },
    });

    // Yearly is billed once per year at the effective monthly rate × 12.
    const yearly = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: Math.round(Number(plan.priceYearly) * 12 * 100),
      recurring: { interval: "year" },
    });

    await plans.updateOne(
      { _id: plan._id },
      {
        $set: {
          stripePriceIdMonth: monthly.id,
          stripePriceIdYear: yearly.id,
        },
      },
    );

    console.log(
      `- ${name}: month=${monthly.id} ($${plan.priceMonthly}/mo)  year=${yearly.id} ($${Number(plan.priceYearly) * 12}/yr)`,
    );
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
