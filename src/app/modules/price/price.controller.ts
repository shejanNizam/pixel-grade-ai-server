import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { ScrydexClient } from "../../services/scrydex/scrydex.client";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PriceServices, PriceWindow } from "./price.service";

const ALLOWED_WINDOWS: PriceWindow[] = ["24h", "7d", "30d", "1y"];

const parseWindow = (raw: unknown): PriceWindow =>
  ALLOWED_WINDOWS.includes(raw as PriceWindow) ? (raw as PriceWindow) : "30d";

const getCardPrice = catchAsync(async (req: Request, res: Response) => {
  const result = await PriceServices.getCardPrice(
    req.params.cardId as string,
    parseWindow(req.query.window),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Price history retrieved successfully!",
    data: result,
  });
});

/** Sparklines for a whole table in one call — see getHistoryBatch. */
const getHistoryBatch = catchAsync(async (req: Request, res: Response) => {
  const raw = req.query.cardIds;
  const cardIds = (Array.isArray(raw) ? raw.join(",") : String(raw ?? ""))
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const result = await PriceServices.getHistoryBatch(
    cardIds,
    parseWindow(req.query.window),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Price history retrieved successfully!",
    data: result,
  });
});

const getPortfolioSummary = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await PriceServices.getPortfolioSummary(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Portfolio summary retrieved successfully!",
    data: result,
  });
});

/** Manual trigger for the sweep the cron also runs — useful for admin recovery
 *  after an outage without waiting for the next scheduled tick. */
const refreshNow = catchAsync(async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 200;
  const result = await PriceServices.refreshStalest(limit);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Price refresh completed.",
    data: result,
  });
});

/**
 * Scrydex credit consumption for the current billing period (admin only).
 *
 * Worth having a route for because Scrydex does not stop serving at the
 * allowance — it rolls silently into billed overage at $0.006/credit on the
 * Starter tier the client is on. Without this, the first sign of a runaway
 * price sweep or a scan spike is an invoice.
 *
 * The usage endpoint does not itself consume credits, so polling it is free.
 */
const getVendorUsage = catchAsync(async (_req: Request, res: Response) => {
  const result = await ScrydexClient.getUsage();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Scrydex usage retrieved successfully!",
    data: result,
  });
});

export const PriceControllers = {
  getCardPrice,
  getHistoryBatch,
  getPortfolioSummary,
  refreshNow,
  getVendorUsage,
};
