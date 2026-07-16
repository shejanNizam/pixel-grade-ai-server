import request from "supertest";
import app from "../app";

describe("GET /", () => {
  it("returns 200 with running message", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("running");
  });
});

describe("GET /health/live", () => {
  it("returns 200 ok immediately (no DB/Redis dependency)", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});

describe("GET /health", () => {
  it("returns a health object with expected shape", async () => {
    const res = await request(app).get("/health");
    // status may be 200 or 503 depending on whether DB/Redis are running in test
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("timestamp");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("services.database");
    expect(res.body).toHaveProperty("services.redis");
  });
});

describe("GET /unknown-route", () => {
  it("returns 404 for unregistered routes", async () => {
    const res = await request(app).get("/this-route-does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("Request ID", () => {
  it("attaches X-Request-Id header to every response", async () => {
    const res = await request(app).get("/");
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("echoes a provided X-Request-Id", async () => {
    const id = "my-custom-correlation-id";
    const res = await request(app).get("/").set("X-Request-Id", id);
    expect(res.headers["x-request-id"]).toBe(id);
  });
});
