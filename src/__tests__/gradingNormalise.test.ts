import {
  DefectCategory,
  DefectSeverity,
  normalise,
} from "../app/services/grading/grading.types";
import { durationToMs } from "../app/utils/setCookie";

/**
 * `normalise` is the only thing standing between the model's JSON and Mongoose.
 * A JSON schema constrains types, not ranges or enum membership at runtime, so
 * everything that could reach the database malformed is clamped or dropped here.
 */
describe("grading normalise", () => {
  const base = {
    grade: 9,
    gradeLabel: "MINT",
    scoreSurface: 9,
    scoreCorners: 9,
    scoreEdges: 9,
    scoreCentering: 10,
    confidence: 68,
    reasoning: "Clean surface, minor edge wear.",
  };

  it("clamps out-of-range scores rather than passing them through", () => {
    const result = normalise(
      { ...base, grade: 11, confidence: 150, scoreSurface: -3 },
      "pixelgrade-v2",
      {},
    );

    expect(result.grade).toBe(10);
    expect(result.confidence).toBe(100);
    expect(result.scoreSurface).toBe(0);
  });

  it("caps confidence at 85 for standard phone photo uploads", () => {
    const result = normalise(
      { ...base, confidence: 95 },
      "pixelgrade-v2",
      {},
      "standard",
    );

    expect(result.confidence).toBe(85);
  });

  it("keeps well-formed defects", () => {
    const result = normalise(
      {
        ...base,
        detectedDefects: [
          {
            category: "edges",
            severity: "minor",
            location: "upper right corner",
            description: "slight whitening",
          },
        ],
      },
      "pixelgrade-v2",
      {},
    );

    expect(result.detectedDefects).toHaveLength(1);
    expect(result.detectedDefects[0].category).toBe(DefectCategory.edges);
    expect(result.detectedDefects[0].severity).toBe(DefectSeverity.minor);
  });

  it("drops defects with an unrecognised category or severity", () => {
    // These would otherwise reach Mongoose and fail far from the cause.
    const result = normalise(
      {
        ...base,
        detectedDefects: [
          { category: "holo", severity: "minor", location: "", description: "" },
          { category: "edges", severity: "critical", location: "", description: "" },
          {
            category: "surface",
            severity: "severe",
            location: "centre",
            description: "crease",
          },
        ],
      },
      "pixelgrade-v2",
      {},
    );

    expect(result.detectedDefects).toHaveLength(1);
    expect(result.detectedDefects[0].category).toBe(DefectCategory.surface);
  });

  it("defaults centering to 50/50 when the measurement is missing", () => {
    // A missing measurement must read as "centred, unknown". Defaulting to 0
    // would silently justify a low centering score the model never gave.
    const result = normalise(base, "pixelgrade-v2", {});

    expect(result.centering).toEqual({ leftPct: 50, topPct: 50 });
  });

  it("survives a v1-shaped response with none of the v2 fields", () => {
    const result = normalise(base, "pixelgrade-v1", {});

    expect(result.detectedDefects).toEqual([]);
    expect(result.imageQuality).toEqual({ score: 0, issues: [] });
  });
});

/**
 * Cookie lifetimes are parsed from the same env strings the JWTs use. A parse
 * failure that silently returned 0 would make every cookie expire instantly.
 */
describe("cookie duration parsing", () => {
  it.each([
    ["1d", 24 * 60 * 60 * 1000],
    ["30d", 30 * 24 * 60 * 60 * 1000],
    ["15m", 15 * 60 * 1000],
    ["2h", 2 * 60 * 60 * 1000],
    ["3600", 3600 * 1000],
  ])("parses %s", (input, expected) => {
    expect(durationToMs(input, -1)).toBe(expected);
  });

  it("falls back rather than returning zero on garbage", () => {
    expect(durationToMs("", 99)).toBe(99);
    expect(durationToMs("soon", 99)).toBe(99);
    expect(durationToMs("0d", 99)).toBe(99);
    expect(durationToMs("-5d", 99)).toBe(99);
  });
});
