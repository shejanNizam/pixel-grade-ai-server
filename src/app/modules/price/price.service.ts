import httpStatus from "http-status";
import { PipelineStage, Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { PricingProvider } from "../../services/pricing.provider";
import { logger } from "../../utils/logger";
import { Card } from "../card/card.model";
import { CollectionItem } from "../collection/collection.model";
import { PriceHistory } from "./price.model";

/** Supported chart windows. `1y` backs the one-year graph. */
const WINDOW_DAYS = { "24h": 1, "7d": 7, "30d": 30, "1y": 365 } as const;
export type PriceWindow = keyof typeof WINDOW_DAYS;

const since = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** Raw points for a sparkline or graph, oldest-first so charts plot directly. */
const getHistory = async (cardId: string, window: PriceWindow = "30d") => {
  const days = WINDOW_DAYS[window] ?? WINDOW_DAYS["30d"];
  return PriceHistory.find({
    card: cardId,
    capturedAt: { $gte: since(days) },
  }).sort({ capturedAt: 1 });
};

/**
 * Bucket size per window, so a sparkline gets a useful number of points rather
 * than every raw sample. The refresh job runs hourly, so a raw 30-day pull is
 * ~720 points per card — for a 120px sparkline that is pure waste, and across a
 * 20-row table it is a 14k-document response.
 *
 * 24h stays raw: bucketing a single day by day would collapse it to one point.
 */
const BUCKET_BY_WINDOW: Record<PriceWindow, "raw" | "day" | "month"> = {
  "24h": "raw",
  "7d": "day",
  "30d": "day",
  "1y": "month",
};

/** Max cards in one batch history request. The price tracker paginates at 6
 *  rows, so this leaves generous headroom without allowing an unbounded fan-out. */
export const MAX_HISTORY_BATCH = 50;

/**
 * Downsampled history for many cards in one round trip.
 *
 * Exists because the price tracker renders a 30-day sparkline per row: without
 * this the client would issue one `/price/:cardId` request per visible card.
 *
 * Each bucket keeps the LAST price in it, matching how the single-card change
 * calculation anchors — a bucket's closing price, not its mean, is what the
 * next bucket's change is measured against.
 */
const getHistoryBatch = async (
  cardIds: string[],
  window: PriceWindow = "30d",
) => {
  const ids = cardIds
    .filter((id) => Types.ObjectId.isValid(id))
    .slice(0, MAX_HISTORY_BATCH)
    .map((id) => new Types.ObjectId(id));

  // Empty in, empty out — an empty $in would scan nothing but still round-trip.
  if (ids.length === 0) return {};

  const days = WINDOW_DAYS[window] ?? WINDOW_DAYS["30d"];
  const bucket = BUCKET_BY_WINDOW[window] ?? "day";

  const bucketKey =
    bucket === "raw"
      ? "$capturedAt"
      : {
          $dateTrunc: {
            date: "$capturedAt",
            unit: bucket === "month" ? "month" : "day",
          },
        };

  const rows = await PriceHistory.aggregate<{
    _id: { card: Types.ObjectId; bucket: Date };
    price: number;
  }>([
    { $match: { card: { $in: ids }, capturedAt: { $gte: since(days) } } },
    // $last below takes the newest point in each bucket, which only holds if
    // the sort runs first.
    { $sort: { capturedAt: 1 } },
    {
      $group: {
        _id: { card: "$card", bucket: bucketKey },
        price: { $last: "$price" },
      },
    },
    { $sort: { "_id.bucket": 1 } },
  ]);

  const byCard: Record<string, { capturedAt: Date; price: number }[]> = {};
  // Every requested id gets a key, so a card with no history yet reads as an
  // empty sparkline rather than an undefined the client has to guard.
  for (const id of ids) byCard[String(id)] = [];

  for (const row of rows) {
    byCard[String(row._id.card)]?.push({
      capturedAt: row._id.bucket,
      price: row.price,
    });
  }

  return byCard;
};

/**
 * Percentage change over a window.
 *
 * Anchored to the earliest point *inside* the window rather than to whatever
 * the previous row happened to be — that keeps "7d change" meaningful even when
 * the refresh job skipped a run and the points are unevenly spaced.
 */
const changeOver = async (
  cardId: Types.ObjectId | string,
  days: number,
  currentPrice?: number,
): Promise<number | undefined> => {
  const earliest = await PriceHistory.findOne({
    card: cardId,
    capturedAt: { $gte: since(days) },
  }).sort({ capturedAt: 1 });

  if (!earliest || !currentPrice || earliest.price === 0) return undefined;
  return Number(
    (((currentPrice - earliest.price) / earliest.price) * 100).toFixed(2),
  );
};

/**
 * Records a fresh quote for one card and fans the result out to every
 * collection entry holding it.
 *
 * The denormalised copy on `collection_items` is what makes collection listing
 * and total-value maths a single query instead of a join per row.
 */
const refreshCard = async (cardId: Types.ObjectId | string) => {
  const card = await Card.findById(cardId);
  if (!card) return null;

  const quote = await PricingProvider.getPrice(card.scrydexCardId);
  if (!quote) return null;

  await PriceHistory.create({
    card: card._id,
    price: quote.price,
    currency: quote.currency,
    source: quote.source,
    capturedAt: quote.capturedAt,
  });

  card.latestPrice = quote.price;
  card.currency = quote.currency;
  card.lastPricedAt = quote.capturedAt;
  await card.save();

  const [change24h, change7d, change30d] = await Promise.all([
    changeOver(card._id, 1, quote.price),
    changeOver(card._id, 7, quote.price),
    changeOver(card._id, 30, quote.price),
  ]);

  await CollectionItem.updateMany(
    { card: card._id },
    {
      currentPrice: quote.price,
      ...(change24h !== undefined ? { change24h } : {}),
      ...(change7d !== undefined ? { change7d } : {}),
      ...(change30d !== undefined ? { change30d } : {}),
    },
  );

  return quote;
};

/**
 * Scheduled sweep. Oldest-priced cards first, so a run that cannot finish the
 * whole catalogue still makes progress on the stalest data rather than
 * re-pricing the same head of the list every hour.
 *
 * Failures are per-card and swallowed: one dead card must not abort the sweep.
 */
const refreshStalest = async (limit = 200) => {
  if (!PricingProvider.isConfigured()) {
    logger.warn("Skipping price refresh — pricing provider is not configured");
    return { refreshed: 0, failed: 0, skipped: true };
  }

  const cards = await Card.find()
    .sort({ lastPricedAt: 1 })
    .limit(limit)
    .select("_id");

  let refreshed = 0;
  let failed = 0;

  for (const card of cards) {
    try {
      const quote = await refreshCard(card._id);
      if (quote) refreshed += 1;
    } catch (error) {
      failed += 1;
      logger.error("Price refresh failed for card", {
        cardId: String(card._id),
        error,
      });
    }
  }

  return { refreshed, failed, skipped: false };
};

/**
 * Dashboard totals over the caller's collection.
 *
 * Quantity-weighted, and the change percentages are value-weighted rather than
 * a plain mean — a 40% move on a $500 card matters more to the portfolio than
 * a 40% move on a $2 common, and averaging the percentages would hide that.
 */
const getPortfolioSummary = async (userId: string) => {
  const pipeline: PipelineStage[] = [
    { $match: { user: new Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalValue: {
          $sum: { $multiply: [{ $ifNull: ["$currentPrice", 0] }, "$quantity"] },
        },
        totalCards: { $sum: "$quantity" },
        weighted24h: {
          $sum: {
            $multiply: [
              { $ifNull: ["$change24h", 0] },
              { $multiply: [{ $ifNull: ["$currentPrice", 0] }, "$quantity"] },
            ],
          },
        },
        weighted7d: {
          $sum: {
            $multiply: [
              { $ifNull: ["$change7d", 0] },
              { $multiply: [{ $ifNull: ["$currentPrice", 0] }, "$quantity"] },
            ],
          },
        },
        weighted30d: {
          $sum: {
            $multiply: [
              { $ifNull: ["$change30d", 0] },
              { $multiply: [{ $ifNull: ["$currentPrice", 0] }, "$quantity"] },
            ],
          },
        },
      },
    },
  ];

  const [summary] = await CollectionItem.aggregate(pipeline);

  if (!summary || summary.totalValue === 0) {
    return {
      totalValue: 0,
      totalCards: summary?.totalCards ?? 0,
      change24h: null,
      change7d: null,
      change30d: null,
    };
  }

  const pct = (weighted: number) =>
    Number((weighted / summary.totalValue).toFixed(2));

  return {
    totalValue: Number(summary.totalValue.toFixed(2)),
    totalCards: summary.totalCards,
    change24h: pct(summary.weighted24h),
    change7d: pct(summary.weighted7d),
    change30d: pct(summary.weighted30d),
  };
};

const getCardPrice = async (cardId: string, window: PriceWindow) => {
  const card = await Card.findById(cardId);
  if (!card) throw new AppError(httpStatus.NOT_FOUND, "Card not found");

  const history = await getHistory(cardId, window);

  return {
    card,
    window,
    history,
    change: await changeOver(
      card._id,
      WINDOW_DAYS[window] ?? 30,
      card.latestPrice,
    ),
  };
};

export const PriceServices = {
  getHistory,
  getHistoryBatch,
  getCardPrice,
  refreshCard,
  refreshStalest,
  getPortfolioSummary,
};
