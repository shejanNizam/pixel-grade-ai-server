import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { SubscriptionControllers } from "./subscription.controller";
import { createCheckoutZodSchema } from "./subscription.validation";

const router = Router();
const anyUser = Object.values(UserRole);

/**
 * @swagger
 * /subscription/me:
 *   get:
 *     tags: [Subscription]
 *     summary: Current plan, renewal date, and credit position
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription, resolved plan, and credit balance
 */
router.get(
  "/me",
  checkAuth(...anyUser),
  SubscriptionControllers.getMySubscription,
);

/**
 * @swagger
 * /subscription/checkout:
 *   post:
 *     tags: [Subscription]
 *     summary: Start a Stripe checkout session
 *     description: >
 *       Yearly plans are charged the effective monthly rate × 12 up front, but
 *       credits still refresh monthly. The subscription is only activated by
 *       the verified webhook — never by the browser returning from Stripe.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Checkout URL
 *       400:
 *         description: Free plan needs no checkout
 *       503:
 *         description: Billing is not configured
 */
router.post(
  "/checkout",
  checkAuth(...anyUser),
  validateRequest(createCheckoutZodSchema),
  SubscriptionControllers.createCheckout,
);

/**
 * @swagger
 * /subscription/cancel:
 *   post:
 *     tags: [Subscription]
 *     summary: Cancel at the end of the current billing period
 *     description: Access continues until the period the user already paid for ends.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Marked to cancel at period end
 *       404:
 *         description: No active subscription
 */
router.post("/cancel", checkAuth(...anyUser), SubscriptionControllers.cancel);

export const SubscriptionRoutes = router;

/**
 * Webhook router, mounted separately in app.ts.
 *
 * It must sit BEFORE express.json() and use a raw body parser: Stripe signs the
 * exact bytes it sent, and a JSON round-trip changes them, so a parsed body
 * fails every signature check.
 */
export const StripeWebhookRoutes = Router();

/**
 * @swagger
 * /webhook/stripe:
 *   post:
 *     tags: [Subscription]
 *     summary: Stripe webhook receiver (called by Stripe, not by clients)
 *     description: >
 *       Unauthenticated by design — authenticity comes from the HMAC signature
 *       in the `stripe-signature` header, not from a bearer token.
 *     responses:
 *       200:
 *         description: Event received
 *       400:
 *         description: Missing or invalid signature
 */
StripeWebhookRoutes.post("/stripe", SubscriptionControllers.webhook);
