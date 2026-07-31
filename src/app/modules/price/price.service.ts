import httpStatus from "http-status";
import { PipelineStage, Types } from "mongoose";
import { PRICE_ALERT_THRESHOLD_PCT } from "../../constants";
import AppError from "../../errorHelpers/AppError";
import { PricingProvider, type PriceQuote } from "../../services/pricing.provider";
import { logger } from "../../utils/logger";
import type { ICard } from "../card/card.interface";
import { Card } from "../card/card.model";
import { CollectionItem } from "../collection/collection.model";
import { NotifType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
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
 * Seeds a card's price history from Scrydex's own daily archive.
 *
 * Without this a brand-new catalogue row has exactly one price point, so the
 * price tracker draws a flat line and the 7d/30d/1y change columns stay empty
 * until the daily sweep has run that many times — a one-year graph would be
 * literally a year away. One extra Scrydex credit buys the whole backlog.
 *
 * Runs at most once per card: `historyBackfilledAt` is the claim. Best-effort
 * throughout — a card with no archive is normal, and a failure here must never
 * cost the caller its live quote.
 */
const backfillHistory = async (cardId: Types.ObjectId | string) => {
  const card = await Card.findById(cardId);
  if (!card || card.historyBackfilledAt) return { inserted: 0 };

  let quotes;
  try {
    quotes = await PricingProvider.getPriceHistory(
      card.scrydexCardId,
      card.game,
      { preferredVariant: card.scrydexVariant },
    );
  } catch (error) {
    logger.warn("Price history backfill failed", {
      cardId: String(card._id),
      error,
    });
    return { inserted: 0 };
  }

  // Stamp the claim even on an empty archive, so a card Scrydex has no history
  // for is not re-requested (and re-billed) on every subsequent sweep.
  card.historyBackfilledAt = new Date();
  await card.save();

  if (quotes.length === 0) return { inserted: 0 };

  // De-duplicate explicitly rather than leaning on a unique index.
  //
  // A card can already hold points from earlier sweeps, and the archive covers
  // days the sweep may already have written. The obvious fix — a unique
  // {card, capturedAt} index — silently does not work: MongoDB will not change
  // an existing index's options, so on any database that already has the
  // non-unique version createIndex fails, Mongoose logs it and continues, and
  // the constraint the code was relying on is simply absent. See price.model.ts.
  const existing = await PriceHistory.find({ card: card._id })
    .select("capturedAt")
    .lean();
  const seen = new Set(
    existing.map((point) => new Date(point.capturedAt).getTime()),
  );

  const fresh = quotes.filter((quote) => !seen.has(quote.capturedAt.getTime()));
  if (fresh.length === 0) return { inserted: 0 };

  try {
    // `ordered: false` so one bad point cannot discard the rest of the archive.
    await PriceHistory.insertMany(
      fresh.map((quote) => ({
        card: card._id,
        price: quote.price,
        currency: quote.currency,
        source: quote.source,
        capturedAt: quote.capturedAt,
      })),
      { ordered: false },
    );
  } catch (error) {
    logger.warn("Price history backfill insert failed", {
      cardId: String(card._id),
      error,
    });
  }

  return { inserted: fresh.length };
};

/** Writes one quote onto a card + its history + every collection entry holding
 *  it, then fires price alerts. Shared by the single and batch paths so the two
 *  cannot drift — a bug fixed in one would otherwise survive in the other. */
const applyQuote = async (card: ICard | null, quote: PriceQuote | null) => {
  if (!card || !quote) return null;

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
  // CLAUDE.md invariant #9 — the basis travels with the number, always. The
  // schema defaults to `raw`, but defaulting is not the same as recording: a
  // graded comp arriving later must overwrite it, not inherit the default.
  card.priceBasis = quote.basis;
  card.priceGradeRef = quote.gradeRef;
  card.priceCondition = quote.condition;
  // Pin the printing the figure came from, so the next refresh prices the same
  // one even if the preference order changes underneath it.
  if (quote.variantName) card.scrydexVariant = quote.variantName;
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

  // Significant daily move → alert everyone holding the card. Runs after the
  // denormalised prices are written so a user clicking through from the alert
  // sees numbers that agree with it. Best-effort: an alert failure must not
  // fail the price write (the sweep counts this card as refreshed either way).
  if (
    change24h !== undefined &&
    Math.abs(change24h) >= PRICE_ALERT_THRESHOLD_PCT
  ) {
    try {
      const holders = await CollectionItem.distinct("user", {
        card: card._id,
      });
      const direction = change24h > 0 ? "up" : "down";
      await Promise.all(
        holders.map((holder) =>
          NotificationServices.create(
            holder,
            NotifType.price_alert,
            `${card.name} is ${direction} ${Math.abs(change24h).toFixed(1)}% today`,
            `Now $${quote.price.toFixed(2)}. You hold this card in your collection.`,
          ),
        ),
      );
    } catch (error) {
      logger.error("Price alert dispatch failed", {
        cardId: String(card._id),
        change24h,
        error,
      });
    }
  }

  return quote;
};

/**
 * Records a fresh quote for one card and fans the result out to every
 * collection entry holding it.
 *
 * The denormalised copy on `collection_items` is what makes collection listing
 * and total-value maths a single query instead of a join per row.
 *
 * Costs 1 Scrydex credit. Anything looping over cards should use
 * `refreshStalest`, which batches 100 cards into that same single credit.
 */
const refreshCard = async (cardId: Types.ObjectId | string) => {
  const card = await Card.findById(cardId);
  if (!card) return null;

  const quote = await PricingProvider.getPrice(
    card.scrydexCardId,
    card.game,
    card.scrydexVariant,
  );

  return applyQuote(card, quote);
};

/**
 * Scheduled sweep. HELD cards first (anything referenced by a collection
 * entry), then the rest of the catalogue with whatever budget remains; within
 * each group, oldest-priced first so an unfinished run still makes progress on
 * the stalest data.
 *
 * Held-first is a Scrydex budget decision, not a performance one: every quote
 * costs credits from the same monthly pool that pays for scans at 5 credits
 * each, so the cards users actually see on their dashboards are refreshed
 * before catalogue strays that nobody holds.
 *
 * ⚠️ The client's account is on Scrydex **Starter — 5,000 credits/month**
 * (verified against the live account on 2026-07-31, not the Growth tier the
 * earlier notes here assumed). Quoting card-by-card at that ceiling would spend
 * the entire month's budget on ~5,000 quotes and leave nothing for scans, which
 * is why this sweep batches: `getPrices` fetches 100 cards per credit, so a
 * 1,000-card pass costs 10 credits, not 1,000.
 *
 * `limit` is a ceiling and there is no staleness floor — every call re-quotes
 * the stalest cards whether or not they were quoted an hour ago. That is fine
 * for one scheduled pass a day, but it means calling this more often multiplies
 * the spend on a catalogue smaller than the limit without buying any new data.
 * Anything that wants a finer cadence should skip cards priced within the last
 * N hours first.
 *
 * Failures are per-card and swallowed: one dead card must not abort the sweep.
 */
const refreshStalest = async (limit = 200) => {
  if (!PricingProvider.isConfigured()) {
    logger.warn("Skipping price refresh — pricing provider is not configured");
    return { refreshed: 0, failed: 0, backfilled: 0, skipped: true };
  }

  // distinct() surfaces a null for any collection entry missing a card, and a
  // null inside the $nin below would exclude nothing while looking like it
  // excludes everything held — so it is filtered out before either query sees it.
  const heldIds = (await CollectionItem.distinct("card")).filter(Boolean);
  const heldKeys = new Set(heldIds.map(String));

  // `scrydexCardId`, `game`, and `scrydexVariant` are all needed to quote, so
  // they are selected here rather than re-read per card inside the loop.
  const projection = "_id scrydexCardId game scrydexVariant";

  const held = await Card.find({ _id: { $in: heldIds } })
    .sort({ lastPricedAt: 1 })
    .limit(limit)
    .select(projection);

  const remaining = limit - held.length;
  const rest =
    remaining > 0
      ? await Card.find({ _id: { $nin: heldIds } })
          .sort({ lastPricedAt: 1 })
          .limit(remaining)
          .select(projection)
      : [];

  const cards = [...held, ...rest];
  if (cards.length === 0) {
    return { refreshed: 0, failed: 0, backfilled: 0, skipped: false };
  }

  // One batched vendor round trip per 100 cards, before any database writes.
  const quotes = await PricingProvider.getPrices(
    cards.map((card) => ({
      scrydexCardId: card.scrydexCardId,
      game: card.game,
      scrydexVariant: card.scrydexVariant,
    })),
  );

  let refreshed = 0;
  let failed = 0;
  let backfilled = 0;

  for (const card of cards) {
    const quote = quotes.get(card.scrydexCardId);
    // Scrydex has no quotable price for this card. Not a failure — plenty of
    // cards genuinely have none — so it is not counted as one.
    if (!quote) continue;

    try {
      // Re-read the full document: the projection above deliberately omits the
      // price fields `applyQuote` writes, and saving a projected document would
      // be a validation error waiting to happen.
      const full = await Card.findById(card._id);
      await applyQuote(full, quote);
      refreshed += 1;

      // Held cards get their historical archive pulled once, so a card someone
      // just added shows a real 30-day sparkline rather than a single dot.
      // Catalogue strays are skipped — nobody is looking at their graph, and
      // each backfill is another credit.
      if (!full?.historyBackfilledAt && heldKeys.has(String(card._id))) {
        const result = await backfillHistory(card._id);
        if (result.inserted > 0) backfilled += 1;
      }
    } catch (error) {
      failed += 1;
      logger.error("Price refresh failed for card", {
        cardId: String(card._id),
        error,
      });
    }
  }

  return { refreshed, failed, backfilled, skipped: false };
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
  backfillHistory,
  getPortfolioSummary,
};
