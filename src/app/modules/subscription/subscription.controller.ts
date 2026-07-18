import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import AppError from "../../errorHelpers/AppError";
import { constructWebhookEvent } from "../../services/stripe.service";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { BillingInterval } from "./subscription.interface";
import { SubscriptionServices } from "./subscription.service";

const createCheckout = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SubscriptionServices.createCheckoutSession(
    userId as string,
    req.body.planId,
    req.body.interval as BillingInterval,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Checkout session created successfully!",
    data: result,
  });
});

/**
 * Stripe webhook.
 *
 * Requires the raw body — see the express.raw mount in app.ts. A 2xx is
 * returned even for events we do not handle, otherwise Stripe retries them
 * forever.
 */
const webhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") {
    throw new AppError(httpStatus.BAD_REQUEST, "Missing stripe-signature header");
  }

  const event = constructWebhookEvent(req.body as Buffer, signature);
  const result = await SubscriptionServices.handleWebhookEvent(event);

  res.status(httpStatus.OK).json({ received: true, ...result });
});

const cancel = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SubscriptionServices.cancelSubscription(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      "Subscription will end at the close of the current billing period.",
    data: result,
  });
});

const getMySubscription = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SubscriptionServices.getMySubscription(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Subscription retrieved successfully!",
    data: result,
  });
});

export const SubscriptionControllers = {
  createCheckout,
  webhook,
  cancel,
  getMySubscription,
};
