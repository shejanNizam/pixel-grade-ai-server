/**
 * Calendar-month boundaries for the dashboard aggregates.
 *
 * Everything here is UTC. Month-over-month figures are compared against each
 * other and shown side by side, so they must all be cut on the same boundary —
 * deriving one from server-local time and another from UTC would put a
 * subscription signed up late on the 31st into different months depending on
 * which query looked at it.
 */

/** Start of the calendar month `offset` months back from now. `0` is this month. */
export const startOfMonth = (offset = 0): Date => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
  );
};

/** `YYYY-MM`, the key format the trend charts plot against. */
export const monthKey = (date: Date): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Month-over-month change as a percentage, rounded to one decimal.
 *
 * Returns `null` rather than 0 or Infinity when the previous period was empty:
 * growth from nothing has no meaningful percentage, and rendering "+100%" for a
 * platform's first ever subscriber would be an invented number. The client
 * shows no delta chip when this is null.
 */
export const percentChange = (
  current: number,
  previous: number,
): number | null => {
  if (previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};
