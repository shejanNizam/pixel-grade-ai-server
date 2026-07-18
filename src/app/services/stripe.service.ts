import httpStatus from "http-status";
import Stripe from "stripe";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";

/**
 * Stripe client.
 *
 * Lazily constructed so a missing key fails on the billing route with a clear
 * message rather than crashing the whole server at import time — the rest of
 * the product works fine without billing configured.
 */

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

/**
 * Verifies a webhook came from Stripe.
 *
 * Requires the RAW request body — if Express has already JSON-parsed it, the
 * bytes differ from what Stripe signed and every event fails verification. See
 * the raw-body mount in app.ts.
 */
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
    // A failed signature check is an authentication failure, not a server bug —
    // returning 400 stops Stripe retrying a payload we will never accept.
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Stripe webhook signature verification failed: ${(error as Error).message}`,
    );
  }
};
