import {
  monthKey,
  percentChange,
  startOfMonth,
} from "../app/utils/dateWindows";

describe("startOfMonth", () => {
  it("returns the first instant of the current UTC month", () => {
    const result = startOfMonth(0);
    expect(result.getUTCDate()).toBe(1);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("walks backwards one calendar month at a time", () => {
    const current = startOfMonth(0);
    const previous = startOfMonth(1);

    expect(previous.getTime()).toBeLessThan(current.getTime());
    // Month arithmetic, not "31 days ago" — the gap varies by month length.
    const monthsApart =
      (current.getUTCFullYear() - previous.getUTCFullYear()) * 12 +
      (current.getUTCMonth() - previous.getUTCMonth());
    expect(monthsApart).toBe(1);
  });

  // Pinned rather than computed from "now": stepping back across a year
  // boundary is exactly where this can go wrong, and a relative assertion
  // would only exercise that path during certain months of the real year.
  describe("crossing a year boundary", () => {
    afterEach(() => jest.useRealTimers());

    it("rolls back into the previous year from January", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-01-15T12:00:00Z"));

      expect(monthKey(startOfMonth(1))).toBe("2025-12");
      expect(monthKey(startOfMonth(13))).toBe("2024-12");
    });

    it("walks a full year back without drifting", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-07-19T12:00:00Z"));

      expect(monthKey(startOfMonth(0))).toBe("2026-07");
      expect(monthKey(startOfMonth(12))).toBe("2025-07");
    });

    it("does not skip February on a 31-day month", () => {
      // Naive "subtract 30 days" arithmetic lands in the wrong month here.
      jest.useFakeTimers().setSystemTime(new Date("2026-03-31T23:59:00Z"));

      expect(monthKey(startOfMonth(1))).toBe("2026-02");
    });
  });

  it("defaults to the current month", () => {
    expect(startOfMonth().getTime()).toBe(startOfMonth(0).getTime());
  });
});

describe("monthKey", () => {
  it("zero-pads single-digit months so keys sort lexically", () => {
    expect(monthKey(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01");
    expect(monthKey(new Date(Date.UTC(2026, 8, 1)))).toBe("2026-09");
  });

  it("uses one-based months, matching how humans read them", () => {
    expect(monthKey(new Date(Date.UTC(2026, 11, 31)))).toBe("2026-12");
  });

  it("reads the date in UTC, not server-local time", () => {
    // 00:30 UTC on the 1st is still the previous month in any negative offset,
    // so a local-time implementation would return the wrong key here.
    expect(monthKey(new Date("2026-07-01T00:30:00Z"))).toBe("2026-07");
  });
});

describe("percentChange", () => {
  it("computes growth and decline", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(75, 100)).toBe(-25);
  });

  it("is zero when nothing moved", () => {
    expect(percentChange(100, 100)).toBe(0);
  });

  it("returns null from a zero baseline rather than Infinity", () => {
    // The whole point of the null: the first ever subscriber is not "+100%",
    // and the card must render no chip instead of an invented number.
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it("rounds to one decimal", () => {
    expect(percentChange(100, 3)).toBe(3233.3);
  });

  it("handles a drop to zero as -100%", () => {
    expect(percentChange(0, 40)).toBe(-100);
  });
});
