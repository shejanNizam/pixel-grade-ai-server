import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { CREDITS_PER_SCAN } from "../constants";
import AppError from "../errorHelpers/AppError";
import { CreditServices } from "../modules/credit/credit.service";
import { UploadSource } from "../modules/analysis/analysis.interface";

/**
 * Server-side feature gating.
 *
 * The frontend also hides locked features, but that is presentation only — these
 * middlewares are the actual enforcement. Every entitlement is resolved from the
 * user's active plan on the server; nothing is read from the request body.
 */

/**
 * Refuses a scan when the wallet cannot cover it.
 *
 * This checks but does not debit. The debit happens inside the scan pipeline
 * once the upload has succeeded, so a user is never charged for a request that
 * failed before any work was done. The check here exists to fail fast and give
 * a clear error rather than letting an expensive upload run first.
 */
export const requireCredits = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const { _id: userId } = req.user as JwtPayload;
    const balance = await CreditServices.getBalance(userId as string);

    if (balance.isUnlimited) return next();

    if ((balance.balance ?? 0) < CREDITS_PER_SCAN) {
      throw new AppError(
        httpStatus.PAYMENT_REQUIRED,
        `A scan costs ${CREDITS_PER_SCAN} credits and your balance is ${balance.balance}. Top up or upgrade your plan to continue.`,
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Gates the Advanced multi-image upload to plans that include PixelScope.
 *
 * Reads the requested mode from the body, but the *entitlement* comes from the
 * plan — a client asking for `pixelscope` on a Free plan is rejected here rather
 * than quietly downgraded, so the failure is visible instead of producing a
 * standard scan the user did not ask for.
 */
export const requirePixelScope = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (req.body?.source !== UploadSource.pixelscope) return next();

    const { _id: userId } = req.user as JwtPayload;
    const plan = await CreditServices.resolvePlan(userId as string);

    if (!plan.pixelscope) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "PixelScope is available on the Collector plan and above. Upgrade to use Advanced scans and earn the Pixel Verified badge.",
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

/** Price tracking is a free feature for all registered users. */
export const requirePriceTracking = async (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  next();
};
