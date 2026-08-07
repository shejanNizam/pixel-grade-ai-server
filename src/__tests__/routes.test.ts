import request from "supertest";
import app from "../app";
import { AnalysisRoutes } from "../app/modules/analysis/analysis.route";
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
  "/api/v1/grading/report/665f1c2ab7e6d21f3c9a1b2d/pdf",
  "/api/v1/notification",
  "/api/v1/notification/unread-count",
];

describe("dashboard and reporting routes", () => {
  it.each(GUARDED_ROUTES)("%s is registered and requires auth", async (path) => {
    const res = await request(app).get(path);

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });

  /**
   * Asserted against the router stack rather than over HTTP, because HTTP
   * cannot tell the two apart: both routes carry the same auth guard, so a
   * shadowed `/history` returns the very same 401 as a working one. Order is
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

/**
 * The admin announcement endpoint.
 *
 * The only route in the system that mints a notification from a request rather
 * than a platform event, so it is the only one that could be used to forge a
 * message to every customer at once. It must never be reachable unauthenticated.
 */
describe("notification broadcast", () => {
  it("POST /notification/broadcast is registered and guarded", async () => {
    const res = await request(app)
      .post("/api/v1/notification/broadcast")
      .send({ title: "Scheduled maintenance" });

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });
});

/**
 * The refund path for an abandoned scan.
 *
 * Credits are debited when identification starts, so cancel is what keeps the
 * client's rule — 10 credits buys a finished report — true for a user who never
 * picked a card. If this route stops being reachable, every abandoned scan
 * silently costs 10 credits until the sweeper catches up.
 */
describe("scan cancellation", () => {
  it("PATCH /analysis/:id/cancel is registered and requires auth", async () => {
    const res = await request(app).patch(
      "/api/v1/analysis/665f1c2ab7e6d21f3c9a1b2d/cancel",
    );

    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });

  /**
   * Checked against the router stack, not over HTTP: `/:id/confirm` and
   * `/:id/cancel` are distinct literals so neither can shadow the other, but a
   * future `/:id/:action` would swallow both and still answer 403. Asserting
   * both paths exist by name is what would catch that.
   */
  it("keeps confirm and cancel as separate literal routes", () => {
    const stack = (
      AnalysisRoutes as unknown as { stack: { route?: { path: string } }[] }
    ).stack;

    const paths = stack.map((layer) => layer.route?.path).filter(Boolean);

    expect(paths).toContain("/:id/confirm");
    expect(paths).toContain("/:id/cancel");
  });
});
