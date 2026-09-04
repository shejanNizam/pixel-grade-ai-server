import { PipelineStage } from "mongoose";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { ITransaction, TxnStatus } from "./transaction.interface";
import { Transaction } from "./transaction.model";

/** The caller's own invoices. */
const getMyTransactions = async (
  userId: string,
  query: Record<string, string>,
) => {
  const queryBuilder = new QueryBuilder<ITransaction>(
    Transaction.find({ user: userId }).populate("plan", "name"),
    query,
  );

  const transactions = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: transactions, meta };
};

const getAllTransactions = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<ITransaction>(
    Transaction.find()
      .populate("user", "name email")
      .populate("plan", "name"),
    query,
  );

  const transactions = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: transactions, meta };
};

/**
 * Admin earnings.
 *
 * Counts only `succeeded` — pending and failed rows exist in the ledger for
 * audit but are not revenue, and refunds are excluded from the total rather
 * than netted, so gross and refunded are both visible.
 */
const getEarnings = async (from?: Date, to?: Date) => {
  const dateFilter: Record<string, Date> = {};
  if (from) dateFilter.$gte = from;
  if (to) dateFilter.$lte = to;

  const match: Record<string, unknown> = { status: TxnStatus.succeeded };
  if (Object.keys(dateFilter).length) match.createdAt = dateFilter;

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ];

  const byType = await Transaction.aggregate(pipeline);

  const refunded = await Transaction.aggregate([
    {
      $match: {
        status: TxnStatus.refunded,
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  const subscriptions = byType.find((r) => r._id === "subscription");
  const slabOrders = byType.find((r) => r._id === "slab_order");
  const pixelScopeOrders = byType.find((r) => r._id === "pixel_scope" || r._id === "pixelscope");

  return {
    grossRevenue: Number(
      byType.reduce((sum, r) => sum + r.total, 0).toFixed(2),
    ),
    subscriptionRevenue: Number((subscriptions?.total ?? 0).toFixed(2)),
    slabOrderRevenue: Number((slabOrders?.total ?? 0).toFixed(2)),
    pixelScopeOrderRevenue: Number((pixelScopeOrders?.total ?? 0).toFixed(2)),
    subscriptionCount: subscriptions?.count ?? 0,
    slabOrderCount: slabOrders?.count ?? 0,
    pixelScopeOrderCount: pixelScopeOrders?.count ?? 0,
    refundedAmount: Number((refunded[0]?.total ?? 0).toFixed(2)),
    refundedCount: refunded[0]?.count ?? 0,
  };
};

/** Revenue bucketed by month, for the admin earnings chart. */
const getRevenueByMonth = async (months = 12) => {
  const from = new Date();
  from.setMonth(from.getMonth() - months);

  return Transaction.aggregate([
    { $match: { status: TxnStatus.succeeded, createdAt: { $gte: from } } },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);
};

export const TransactionServices = {
  getMyTransactions,
  getAllTransactions,
  getEarnings,
  getRevenueByMonth,
};
