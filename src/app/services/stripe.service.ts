import httpStatus from "http-status";
import Stripe from "stripe";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";

let stripe: Stripe | null = null;

export const getStripe = (): Stripe => {
  if (!configs.STRIPE.secret_key) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Billing is not configured — STRIPE_SECRET_KEY is missing.",
    );
  }
  stripe ??= new Stripe(configs.STRIPE.secret_key);
  return stripe;
};

export const isStripeConfigured = (): boolean =>
  Boolean(configs.STRIPE.secret_key);

export const constructWebhookEvent = (
  rawBody: Buffer,
  signature: string,
): Stripe.Event => {
  if (!configs.STRIPE.webhook_secret) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Webhook handling is not configured — STRIPE_WEBHOOK_SECRET is missing.",
    );
  }

  try {
    return getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      configs.STRIPE.webhook_secret,
    );
  } catch (error) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Stripe webhook signature verification failed: ${(error as Error).message}`,
    );
  }
};

/**
 * Creates a Stripe Checkout Session for a one-off Physical Slab order.
 */
export const createSlabCheckoutSession = async ({
  items,
  shippingFee,
  taxAmount,
  successUrl,
  cancelUrl,
  customerEmail,
  metadata = {},
}: {
  items: Array<{ name: string; amountInCents: number; quantity: number }>;
  shippingFee: number;
  taxAmount: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}) => {
  const stripeClient = getStripe();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map(
    (i) => ({
      price_data: {
        currency: "usd",
        product_data: {
          name: `${i.name} Custom Physical Slab`,
        },
        unit_amount: Math.round(i.amountInCents),
      },
      quantity: i.quantity,
    }),
  );

  if (shippingFee > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: "USPS Ground Advantage Shipping (via Shippo)",
        },
        unit_amount: Math.round(shippingFee * 100),
      },
      quantity: 1,
    });
  }

  if (taxAmount > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: "Estimated Sales Tax (8.50%)",
        },
        unit_amount: Math.round(taxAmount * 100),
      },
      quantity: 1,
    });
  }

  const session = await stripeClient.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    customer_email: customerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      type: "physical_slab_order",
      ...metadata,
    },
  });

  return { sessionId: session.id, url: session.url };
};

/**
 * Creates a one-off Stripe PaymentIntent for physical slab orders.
 */
export const createSlabPaymentIntent = async ({
  amountInCents,
  userId,
  metadata = {},
}: {
  amountInCents: number;
  userId: string;
  metadata?: Record<string, string>;
}) => {
  const stripeClient = getStripe();
  const paymentIntent = await stripeClient.paymentIntents.create({
    amount: Math.round(amountInCents),
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    metadata: {
      userId,
      type: "physical_slab_order",
      ...metadata,
    },
  });

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };
};
