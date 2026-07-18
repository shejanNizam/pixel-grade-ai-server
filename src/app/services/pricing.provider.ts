import httpStatus from "http-status";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { PriceSource } from "../modules/price/price.interface";

/**
 * Market pricing.
 *
 * Vendor unconfirmed (docs/OPEN-QUESTIONS.md #2) — the shape below is ours, not
 * a vendor spec. Returns null rather than throwing on a per-card miss so one
 * unpriced card cannot abort a sweep over thousands.
 */

export interface PriceQuote {
  price: number;
  currency: string;
  source: PriceSource;
  capturedAt: Date;
}

const isConfigured = (): boolean => Boolean(configs.PRICING.api_key);

const getPrice = async (scrydexCardId: string): Promise<PriceQuote | null> => {
  if (!isConfigured()) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Price tracking is not configured — PRICING_API_KEY is missing. See docs/OPEN-QUESTIONS.md.",
    );
  }

  // TODO(client-credentials): implement against the confirmed pricing source.
  throw new AppError(
    httpStatus.NOT_IMPLEMENTED,
    `Pricing vendor call is not implemented yet (card=${scrydexCardId}).`,
  );
};

export const PricingProvider = {
  getPrice,
  isConfigured,
};
