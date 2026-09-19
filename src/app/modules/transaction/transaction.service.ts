import { PipelineStage } from "mongoose";
import { EARNINGS_RESET_DATE } from "../../constants";
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
    Transaction.find({ createdAt: { $gte: EARNINGS_RESET_DATE } })
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
 * Counts only `succeeded` from EARNINGS_RESET_DATE forward — pending and failed rows exist in the ledger for
 * audit but are not revenue, and refunds are excluded from the total rather
 * than netted, so gross and refunded are both visible.
 */
const getEarnings = async (from?: Date, to?: Date) => {
  const effectiveFrom =
    from && from > EARNINGS_RESET_DATE ? from : EARNINGS_RESET_DATE;
  const dateFilter: Record<string, Date> = { $gte: effectiveFrom };
  if (to) dateFilter.$lte = to;

  const match: Record<string, unknown> = {
    status: TxnStatus.succeeded,
    createdAt: dateFilter,
  };

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
        createdAt: dateFilter,
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);

  const subscriptions = byType.find((r) => r._id === "subscription");
  const slabOrders = byType.find((r) => r._id === "slab_order");
  const pixelScopeOrders = byType.find(
    (r) => r._id === "pixel_scope" || r._id === "pixelscope",
  );

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
  const effectiveFrom = from > EARNINGS_RESET_DATE ? from : EARNINGS_RESET_DATE;

  return Transaction.aggregate([
    {
      $match: {
        status: TxnStatus.succeeded,
        createdAt: { $gte: effectiveFrom },
      },
    },
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
