import httpStatus from "http-status";
import { PipelineStage, Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Card } from "../card/card.model";
import { GradingReport } from "../grading/grading.model";
import { monthKey, startOfMonth } from "../../utils/dateWindows";
import { logger } from "../../utils/logger";
import { PriceHistory } from "../price/price.model";
import { PriceServices } from "../price/price.service";
import { ICollectionItem } from "./collection.interface";
import { CollectionItem } from "./collection.model";

/**
 * ACCESS NOTE: the requirements gate collection management to Collector and
 * above, but whether Free gets any access — and any size cap — is still
 * unresolved (docs/OPEN-QUESTIONS.md #5). These routes are therefore ungated.
 * When the client answers, add `requireCollection` to the routes rather than
 * scattering plan checks through this service.
 */

const SORTABLE = {
  addedAt: "addedAt",
  price: "currentPrice",
  grade: "report.grade",
  name: "card.name",
} as const;

type SortKey = keyof typeof SORTABLE;

/**
 * Listing needs to filter on fields that live in three different collections —
 * name/set/rarity on the card, grade on the report, price on the entry — so this
 * is an aggregation rather than a QueryBuilder chain. `$facet` returns the page
 * and the total count in one round trip instead of a second countDocuments.
 */
const getMyCollection = async (
  userId: string,
  query: Record<string, string>,
) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const match: Record<string, unknown> = {};

  if (query.searchTerm) {
    match["card.name"] = { $regex: query.searchTerm, $options: "i" };
  }
  if (query.set) match["card.setExpansion"] = query.set;
  if (query.rarity) match["card.rarity"] = query.rarity;
  if (query.favorite) match.favorite = query.favorite === "true";

  // Ranges are inclusive on both ends. Each bound is applied independently so
  // "min only" and "max only" both work.
  const gradeRange: Record<string, number> = {};
  if (query.minGrade) gradeRange.$gte = Number(query.minGrade);
  if (query.maxGrade) gradeRange.$lte = Number(query.maxGrade);
  if (Object.keys(gradeRange).length) match["report.grade"] = gradeRange;

  const priceRange: Record<string, number> = {};
  if (query.minPrice) priceRange.$gte = Number(query.minPrice);
  if (query.maxPrice) priceRange.$lte = Number(query.maxPrice);
  if (Object.keys(priceRange).length) match.currentPrice = priceRange;

  const sortKey = (query.sortBy as SortKey) in SORTABLE
    ? (query.sortBy as SortKey)
    : "addedAt";
  const sortField = SORTABLE[sortKey];
  const sortDir = query.sortOrder === "asc" ? 1 : -1;

  const pipeline: PipelineStage[] = [
    { $match: { user: new Types.ObjectId(userId) } },
    {
      $lookup: {
        from: Card.collection.name,
        localField: "card",
        foreignField: "_id",
        as: "card",
      },
    },
    { $unwind: "$card" },
    {
      $lookup: {
        from: GradingReport.collection.name,
        localField: "report",
        foreignField: "_id",
        as: "report",
      },
    },
    // Manual entries have no report, so this must preserve the document rather
    // than dropping it — otherwise manually-added cards vanish from the list.
    { $unwind: { path: "$report", preserveNullAndEmptyArrays: true } },
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    { $sort: { [sortField]: sortDir, _id: 1 } },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        total: [{ $count: "count" }],
      },
    },
  ];

  const [result] = await CollectionItem.aggregate(pipeline);
  const data = result?.data ?? [];
  const total = result?.total?.[0]?.count ?? 0;

  return {
    data,
    meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
  };
};

/**
 * Dashboard and Creator Profile metrics. Quantity-weighted: two copies of a $50
 * card are $100 of collection value, and count as two cards.
 *
 * The average grade covers only graded entries — averaging manual entries in as
 * zero would drag the number down and misrepresent the collection.
 *
 * EVERY figure here is scoped to the COLLECTION, never to grading reports
 * (client, UI Feedback v1 edit #3). Grading a card does not put it in your
 * collection; adding it does. The Creator Profile previously counted reports for
 * its showcase and confidence average while taking totals from here, so a user
 * who had graded three cards and added two saw "Total cards 2" beside three
 * showcase tiles. `pixelVerifiedCount` and `averageConfidence` moved here for
 * that reason — computing them from a page of reports also silently under-counts
 * anyone with more reports than the page size.
 *
 * `pixelVerifiedCount` filters on the report's `pixelVerified` FLAG, never on
 * "has a report". The badge is a specific server-side award; counting every
 * graded entry would empty it of the meaning the award exists to protect.
 */
const getSummary = async (userId: string) => {
  const pipeline: PipelineStage[] = [
    { $match: { user: new Types.ObjectId(userId) } },
    {
      $lookup: {
        from: GradingReport.collection.name,
        localField: "report",
        foreignField: "_id",
        as: "report",
      },
    },
    { $unwind: { path: "$report", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: null,
        totalValue: {
          $sum: { $multiply: [{ $ifNull: ["$currentPrice", 0] }, "$quantity"] },
        },
        totalCards: { $sum: "$quantity" },
        entryCount: { $sum: 1 },
        gradeSum: {
          $sum: { $ifNull: [{ $multiply: ["$report.grade", "$quantity"] }, 0] },
        },
        gradedCount: {
          $sum: { $cond: [{ $ifNull: ["$report", false] }, "$quantity", 0] },
        },
        // Entries, not quantity: holding four copies of one Pixel Verified card
        // is one verified card, not four.
        pixelVerifiedCount: {
          $sum: { $cond: [{ $eq: ["$report.pixelVerified", true] }, 1, 0] },
        },
        confidenceSum: { $sum: { $ifNull: ["$report.confidence", 0] } },
        confidenceCount: {
          $sum: {
            $cond: [{ $ifNull: ["$report.confidence", false] }, 1, 0],
          },
        },
      },
    },
  ];

  const [summary] = await CollectionItem.aggregate(pipeline);

  if (!summary) {
    return {
      totalValue: 0,
      totalCards: 0,
      entryCount: 0,
      averageGrade: null,
      pixelVerifiedCount: 0,
      averageConfidence: null,
    };
  }

  return {
    totalValue: Number(summary.totalValue.toFixed(2)),
    totalCards: summary.totalCards,
    entryCount: summary.entryCount,
    averageGrade:
      summary.gradedCount > 0
        ? Number((summary.gradeSum / summary.gradedCount).toFixed(2))
        : null,
    pixelVerifiedCount: summary.pixelVerifiedCount,
    // Null rather than 0 when nothing is graded — "no data" and "0% confident"
    // are different claims and the profile renders them differently.
    averageConfidence:
      summary.confidenceCount > 0
        ? Math.round(summary.confidenceSum / summary.confidenceCount)
        : null,
  };
};

/**
 * Collection value per calendar month, for the dashboard's trend chart.
 *
 * Assembled in application code rather than one aggregation because it is a
 * cross product of two independent series — which entries the user held in a
 * month, and what those cards were worth that month — and expressing the
 * carry-forward below in the pipeline would be far harder to keep correct than
 * it is to read here. Both inputs are user-scale and already downsampled to at
 * most one point per card per month.
 *
 * Two deliberate approximations, because the honest answer is unknowable:
 *
 *  - Quantity is taken as today's quantity. Entries record no quantity history,
 *    so a user who owned one copy in March and three today reads as three in
 *    March. Fixing this needs a quantity audit trail, not a smarter query.
 *  - For months before a card's price history begins, the EARLIEST known price
 *    is carried backwards. The platform is younger than the collections in it,
 *    so the alternative — zero — would draw a cliff that never happened. It
 *    assumes a flat price before we started watching, which is wrong but
 *    wrong by less than a cliff is.
 */
const getValueOverTime = async (userId: string, months = 12) => {
  const windowMonths = Math.min(Math.max(months, 1), 36);
  const from = startOfMonth(windowMonths - 1);

  const items = await CollectionItem.find({ user: new Types.ObjectId(userId) })
    .select("card quantity currentPrice addedAt")
    .lean();

  const buckets = Array.from({ length: windowMonths }, (_, i) =>
    startOfMonth(windowMonths - 1 - i),
  );

  if (items.length === 0) {
    return buckets.map((date) => ({ month: monthKey(date), value: 0 }));
  }

  const cardIds = [...new Set(items.map((item) => String(item.card)))].map(
    (id) => new Types.ObjectId(id),
  );

  // One closing price per card per month.
  const points = await PriceHistory.aggregate<{
    _id: { card: Types.ObjectId; bucket: Date };
    price: number;
  }>([
    { $match: { card: { $in: cardIds }, capturedAt: { $gte: from } } },
    { $sort: { capturedAt: 1 } },
    {
      $group: {
        _id: {
          card: "$card",
          bucket: { $dateTrunc: { date: "$capturedAt", unit: "month" } },
        },
        price: { $last: "$price" },
      },
    },
  ]);

  const priceByCardMonth = new Map<string, number>();
  for (const point of points) {
    priceByCardMonth.set(
      `${String(point._id.card)}:${monthKey(point._id.bucket)}`,
      point.price,
    );
  }

  // Walk each card forward once, filling gap months from the last known price,
  // then backfill the months before its history starts (see the note above).
  const resolved = new Map<string, number>();
  for (const cardId of cardIds.map(String)) {
    let carried: number | undefined;
    let firstKnown: number | undefined;
    const leadingGap: string[] = [];

    for (const bucket of buckets) {
      const key = `${cardId}:${monthKey(bucket)}`;
      const known = priceByCardMonth.get(key);

      if (known !== undefined) {
        carried = known;
        firstKnown ??= known;
      }

      // Still before this card's first quote — remember the month and fill it
      // once we know what that first quote was.
      if (carried === undefined) {
        leadingGap.push(key);
        continue;
      }
      resolved.set(key, carried);
    }

    if (firstKnown !== undefined) {
      for (const key of leadingGap) resolved.set(key, firstKnown);
    }
  }

  return buckets.map((bucket) => {
    const key = monthKey(bucket);
    const bucketEnd = new Date(
      Date.UTC(bucket.getUTCFullYear(), bucket.getUTCMonth() + 1, 1),
    );

    const value = items.reduce((sum, item) => {
      // An entry contributes nothing to a month that ended before it was added.
      if (item.addedAt && item.addedAt >= bucketEnd) return sum;

      const price =
        resolved.get(`${String(item.card)}:${key}`) ?? item.currentPrice ?? 0;
      return sum + price * (item.quantity ?? 1);
    }, 0);

    return { month: key, value: Number(value.toFixed(2)) };
  });
};

/** Collection grouped by set, for the dashboard breakdown. */
const getBySet = async (userId: string) => {
  return CollectionItem.aggregate([
    { $match: { user: new Types.ObjectId(userId) } },
    {
      $lookup: {
        from: Card.collection.name,
        localField: "card",
        foreignField: "_id",
        as: "card",
      },
    },
    { $unwind: "$card" },
    {
      $group: {
        _id: "$card.setExpansion",
        count: { $sum: "$quantity" },
        value: {
          $sum: { $multiply: [{ $ifNull: ["$currentPrice", 0] }, "$quantity"] },
        },
      },
    },
    { $sort: { count: -1 } },
  ]);
};

/**
 * Adds an entry. Two paths converge here:
 *  - scanned: `report` points at a grading report, and the card is taken from
 *    that report so a client cannot attach someone else's grade to a card.
 *  - manual: no report, the user supplies card and image directly.
 */
const addItem = async (userId: string, payload: Partial<ICollectionItem>) => {
  if (payload.report) {
    const report = await GradingReport.findOne({
      _id: payload.report,
      user: userId,
    });
    if (!report) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        "Grading report not found, or it does not belong to you.",
      );
    }
    // Card identity comes from the report, never from the request body.
    payload.card = report.card;
  }

  if (!payload.card) {
    throw new AppError(httpStatus.BAD_REQUEST, "card is required");
  }

  const card = await Card.findById(payload.card);
  if (!card) throw new AppError(httpStatus.NOT_FOUND, "Card not found");

  // Price it now if nobody has. A card is usually added moments after being
  // identified, so it has no quote yet and would otherwise sit at $0 on the
  // user's collection and portfolio total until the 00:30 sweep — on the very
  // screen whose whole point is what the card is worth.
  //
  // Two Scrydex credits at most (a quote plus the historical archive), spent
  // only on a deliberate user action, and best-effort: a vendor outage must not
  // stop someone adding a card to their own collection.
  if (!card.latestPrice) {
    try {
      const quote = await PriceServices.refreshCard(card._id);
      await PriceServices.backfillHistory(card._id);
      // refreshCard wrote to its own copy of the document, so mirror the figure
      // onto this one rather than re-reading it.
      if (quote) card.latestPrice = quote.price;
    } catch (error) {
      logger.warn("Could not price a card on collection add", {
        cardId: String(card._id),
        error,
      });
    }
  }

  return CollectionItem.create({
    ...payload,
    user: userId,
    // Seed the denormalised price so the entry has a value before the next
    // pricing sweep runs.
    currentPrice: payload.currentPrice ?? card.latestPrice,
  });
};

const getSingleItem = async (userId: string, itemId: string) => {
  const item = await CollectionItem.findOne({ _id: itemId, user: userId })
    .populate("card")
    .populate("report");
  if (!item) throw new AppError(httpStatus.NOT_FOUND, "Collection item not found");
  return item;
};

/** Only the user-editable fields are accepted; price and card identity are
 *  system-owned and silently ignored if sent. */
const updateItem = async (
  userId: string,
  itemId: string,
  payload: Partial<ICollectionItem>,
) => {
  const allowed: Partial<ICollectionItem> = {};
  if (payload.quantity !== undefined) allowed.quantity = payload.quantity;
  if (payload.favorite !== undefined) allowed.favorite = payload.favorite;
  if (payload.externalGrade !== undefined) {
    allowed.externalGrade = payload.externalGrade;
  }
  if (payload.manualImageUrl !== undefined) {
    allowed.manualImageUrl = payload.manualImageUrl;
  }

  const item = await CollectionItem.findOneAndUpdate(
    { _id: itemId, user: userId },
    allowed,
    { returnDocument: "after", runValidators: true },
  );
  if (!item) throw new AppError(httpStatus.NOT_FOUND, "Collection item not found");
  return item;
};

const removeItem = async (userId: string, itemId: string) => {
  const deleted = await CollectionItem.findOneAndDelete({
    _id: itemId,
    user: userId,
  });
  if (!deleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Collection item not found");
  }
  // The grading report and its images are deliberately NOT deleted — they are
  // retained permanently as training data.
  return deleted;
};

export const CollectionServices = {
  getMyCollection,
  getSummary,
  getValueOverTime,
  getBySet,
  addItem,
  getSingleItem,
  updateItem,
  removeItem,
};
