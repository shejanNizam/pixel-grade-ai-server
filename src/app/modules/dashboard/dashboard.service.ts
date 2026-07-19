import { Types } from "mongoose";
import { percentChange, startOfMonth } from "../../utils/dateWindows";
import { CardAnalysis } from "../analysis/analysis.model";
import { CollectionItem } from "../collection/collection.model";
import { CollectionServices } from "../collection/collection.service";
import { GradingReport } from "../grading/grading.model";
import { SlabOrder } from "../slab/slab.model";
import { SlabOrderStatus } from "../slab/slab.interface";
import { SubscriptionServices } from "../subscription/subscription.service";
import { TransactionServices } from "../transaction/transaction.service";
import { User } from "../user/user.model";
import { IAdminOverview, IStatCard, IUserOverview } from "./dashboard.interface";

const card = (value: number, previous: number): IStatCard => ({
  value: Number(value.toFixed(2)),
  delta: percentChange(value, previous),
});

/**
 * Admin landing page: four stat cards and MRR.
 *
 * Each delta compares against the same point — the start of this month — so the
 * four cards are talking about the same period rather than each picking its own.
 *
 * The `subscribedUsers` baseline is an approximation and worth understanding
 * before trusting it: subscriptions record their current status, not a status
 * history, so "how many were active a month ago" cannot be answered exactly.
 * Today's active count minus this month's signups is used instead, which
 * undercounts churn — someone who subscribed in March and cancelled last week
 * is absent from both numbers rather than showing as a loss. Fixing it properly
 * needs a status audit trail.
 */
const getAdminOverview = async (): Promise<IAdminOverview> => {
  const thisMonth = startOfMonth(0);
  const lastMonth = startOfMonth(1);

  const [
    totalUsers,
    usersBeforeThisMonth,
    subscriberStats,
    allTimeEarnings,
    thisMonthEarnings,
    lastMonthEarnings,
  ] = await Promise.all([
    User.countDocuments({ isDeleted: false }),
    User.countDocuments({ isDeleted: false, createdAt: { $lt: thisMonth } }),
    SubscriptionServices.getSubscriberStats(),
    TransactionServices.getEarnings(),
    TransactionServices.getEarnings(thisMonth),
    TransactionServices.getEarnings(lastMonth, thisMonth),
  ]);

  const { activeSubscriptions, newThisMonth, newLastMonth, mrr } =
    subscriberStats;

  return {
    totalUsers: card(totalUsers, usersBeforeThisMonth),
    subscribedUsers: card(
      activeSubscriptions,
      activeSubscriptions - newThisMonth,
    ),
    newSubscribers: card(newThisMonth, newLastMonth),
    // The card shows lifetime revenue; the delta compares this month's take
    // against last month's, which is the number that actually moves.
    totalEarnings: {
      value: Number(allTimeEarnings.grossRevenue.toFixed(2)),
      delta: percentChange(
        thisMonthEarnings.grossRevenue,
        lastMonthEarnings.grossRevenue,
      ),
    },
    mrr,
  };
};

/**
 * User landing page: five stat cards.
 *
 * Collection value comes from the same series the trend chart plots, so the
 * headline figure and the chart's last point can never disagree.
 */
const getUserOverview = async (userId: string): Promise<IUserOverview> => {
  const user = new Types.ObjectId(userId);
  const thisMonth = startOfMonth(0);

  const [
    valueSeries,
    summary,
    cardsBeforeThisMonth,
    slabsOrdered,
    slabsBeforeThisMonth,
    totalScans,
    scansBeforeThisMonth,
    gradeThisMonth,
    gradeLastMonth,
  ] = await Promise.all([
    CollectionServices.getValueOverTime(userId, 2),
    CollectionServices.getSummary(userId),
    CollectionItem.aggregate<{ total: number }>([
      { $match: { user, addedAt: { $lt: thisMonth } } },
      { $group: { _id: null, total: { $sum: "$quantity" } } },
    ]),
    // Cancelled orders are not "ordered" — counting them would inflate the
    // figure with slabs the user explicitly backed out of.
    SlabOrder.countDocuments({
      user,
      status: { $ne: SlabOrderStatus.canceled },
    }),
    SlabOrder.countDocuments({
      user,
      status: { $ne: SlabOrderStatus.canceled },
      createdAt: { $lt: thisMonth },
    }),
    CardAnalysis.countDocuments({ user }),
    CardAnalysis.countDocuments({ user, createdAt: { $lt: thisMonth } }),
    GradingReport.aggregate<{ avg: number }>([
      { $match: { user, createdAt: { $gte: thisMonth } } },
      { $group: { _id: null, avg: { $avg: "$grade" } } },
    ]),
    GradingReport.aggregate<{ avg: number }>([
      {
        $match: {
          user,
          createdAt: { $gte: startOfMonth(1), $lt: thisMonth },
        },
      },
      { $group: { _id: null, avg: { $avg: "$grade" } } },
    ]),
  ]);

  // getValueOverTime always returns one entry per requested month, so with
  // months=2 these are last month and this month respectively.
  const previousValue = valueSeries[0]?.value ?? 0;
  const currentValue = valueSeries[valueSeries.length - 1]?.value ?? 0;

  return {
    collectionValue: card(currentValue, previousValue),
    cardsInCollection: card(
      summary.totalCards,
      cardsBeforeThisMonth[0]?.total ?? 0,
    ),
    slabsOrdered: card(slabsOrdered, slabsBeforeThisMonth),
    totalScans: card(totalScans, scansBeforeThisMonth),
    averageGrade:
      summary.averageGrade === null
        ? null
        : {
            value: summary.averageGrade,
            // Compares the grades awarded this month against last month's, not
            // the lifetime average against itself — the latter barely moves
            // once a collection is established and would read as flat forever.
            delta: percentChange(
              gradeThisMonth[0]?.avg ?? 0,
              gradeLastMonth[0]?.avg ?? 0,
            ),
          },
  };
};

export const DashboardServices = {
  getAdminOverview,
  getUserOverview,
};
