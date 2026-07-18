import httpStatus from "http-status";
import { PipelineStage, Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { Card } from "../card/card.model";
import { GradingReport } from "../grading/grading.model";
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
 * Dashboard metrics. Quantity-weighted: two copies of a $50 card are $100 of
 * collection value, and count as two cards.
 *
 * The average grade covers only graded entries — averaging manual entries in as
 * zero would drag the number down and misrepresent the collection.
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
  };
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
  getBySet,
  addItem,
  getSingleItem,
  updateItem,
  removeItem,
};
