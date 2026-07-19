/**
 * Read-only aggregates for the two dashboard landing pages.
 *
 * This module owns no collection of its own — it composes the services that do.
 * It exists because both dashboards open with a row of stat cards drawn from
 * four or five different domains at once, and the alternative is the client
 * fanning out five requests just to paint the first screen.
 */

/**
 * A stat card. `delta` is a month-over-month percentage and is deliberately
 * nullable: growth from a zero baseline has no meaningful percentage, and the
 * card renders no chip rather than an invented "+100%".
 */
export interface IStatCard {
  value: number;
  delta: number | null;
}

export interface IAdminOverview {
  totalUsers: IStatCard;
  subscribedUsers: IStatCard;
  newSubscribers: IStatCard;
  totalEarnings: IStatCard;
  /** Monthly recurring revenue — the monthly-equivalent of active subscriptions. */
  mrr: number;
}

export interface IUserOverview {
  collectionValue: IStatCard;
  cardsInCollection: IStatCard;
  slabsOrdered: IStatCard;
  totalScans: IStatCard;
  /** Null when the user has no graded cards — an ungraded collection has no
   *  average, which is not the same as an average of zero. */
  averageGrade: IStatCard | null;
}
