import request from "supertest";
import app from "../app";
import { PriceRoutes } from "../app/modules/price/price.route";

/**
 * Registration smoke tests for the dashboard/reporting endpoints.
 *
 * These assert only that a route EXISTS and is guarded — an unauthenticated
 * request is rejected by `checkAuth` before anything touches Mongo or Redis, so
 * the suite needs no infrastructure. A 404 here means the router was never
 * mounted; a 403 means it was.
 *
 * The `/price/history` case is the one that earns its keep: it sits next to a
 * `/:cardId` param route, and if it is ever registered after that route the
 * param will swallow "history" and the batch endpoint silently becomes a lookup
 * for a card whose id is the literal string "history".
 */

const GUARDED_ROUTES = [
  "/api/v1/dashboard/me",
  "/api/v1/dashboard/admin",
  "/api/v1/collection/value-over-time",
  "/api/v1/price/history",
  "/api/v1/subscription/subscribers",
  "/api/v1/subscription/stats",
];

describe("dashboard and reporting routes", () => {
  it.each(GUARDED_ROUTES)("%s is registered and requires auth", async (path) => {
    const res = await request(app).get(path);

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(403);
  });

  /**
   * Asserted against the router stack rather than over HTTP, because HTTP
   * cannot tell the two apart: both routes carry the same auth guard, so a
   * shadowed `/history` returns the very same 403 as a working one. Order is
   * the only observable difference, so order is what this checks.
   */
  it("registers /price/history ahead of /price/:cardId", () => {
    const stack = (
      PriceRoutes as unknown as { stack: { route?: { path: string } }[] }
    ).stack;

    const paths = stack.map((layer) => layer.route?.path).filter(Boolean);
    const historyAt = paths.indexOf("/history");
    const paramAt = paths.indexOf("/:cardId");

    expect(historyAt).toBeGreaterThanOrEqual(0);
    expect(paramAt).toBeGreaterThanOrEqual(0);
    expect(historyAt).toBeLessThan(paramAt);
  });
});
