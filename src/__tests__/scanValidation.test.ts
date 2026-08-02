import { validateImageSet } from "../app/modules/analysis/analysis.service";
import { ImageSide, UploadSource } from "../app/modules/analysis/analysis.interface";
import { ScrydexMock } from "../app/services/scrydex.mock";
import { configs } from "../app/config/index";

const img = (side: ImageSide, slotIndex = 0) => ({
  imageUrl: `https://res.cloudinary.com/demo/${side}-${slotIndex}.jpg`,
  side,
  slotIndex,
});

describe("validateImageSet — standard scans", () => {
  it("accepts one front image alone", () => {
    expect(() =>
      validateImageSet(UploadSource.standard, [img(ImageSide.front)]),
    ).not.toThrow();
  });

  it("accepts front + back (the Quick Import shape)", () => {
    expect(() =>
      validateImageSet(UploadSource.standard, [
        img(ImageSide.front),
        img(ImageSide.back),
      ]),
    ).not.toThrow();
  });

  it("rejects two images of the SAME side — the limit is per side, not total", () => {
    expect(() =>
      validateImageSet(UploadSource.standard, [
        img(ImageSide.front, 0),
        img(ImageSide.front, 1),
      ]),
    ).toThrow(/one front and one back/);
  });

  it("rejects an empty set", () => {
    expect(() => validateImageSet(UploadSource.standard, [])).toThrow(
      /At least one image/,
    );
  });
});

describe("validateImageSet — PixelScope scans", () => {
  it("accepts ten per side", () => {
    const images = [
      ...Array.from({ length: 10 }, (_, i) => img(ImageSide.front, i)),
      ...Array.from({ length: 10 }, (_, i) => img(ImageSide.back, i)),
    ];
    expect(() =>
      validateImageSet(UploadSource.pixelscope, images),
    ).not.toThrow();
  });

  it("rejects an eleventh image on one side", () => {
    const images = Array.from({ length: 11 }, (_, i) =>
      img(ImageSide.front, i % 10),
    );
    expect(() => validateImageSet(UploadSource.pixelscope, images)).toThrow(
      /at most 10 images per side/,
    );
  });
});

describe("ScrydexMock gating", () => {
  // The test env sets NODE_ENV=test (see setup.ts), so even if MOCK_SCRYDEX
  // leaked into the test environment the mock must stay off: the flag is only
  // honored under NODE_ENV=development. This is the production-safety half of
  // the double gate, and it is the single most important property of the mock.
  it("is disabled outside NODE_ENV=development regardless of the env flag", () => {
    expect(configs.node_env).not.toBe("development");
    expect(ScrydexMock.enabled()).toBe(false);
    // Both halves independently — `MOCK_SCRYDEX=vision` mocks only one of them,
    // so a gate that checked the combined flag could leak the other.
    expect(ScrydexMock.visionEnabled()).toBe(false);
    expect(ScrydexMock.pricingEnabled()).toBe(false);
  });

  it("fabricated ids are mock-prefixed so leaked rows are identifiable", () => {
    // Reach past the gate on purpose — this asserts the DATA shape, not the gate.
    const result = ScrydexMock.identify(
      "pokemon" as Parameters<typeof ScrydexMock.identify>[0],
    );
    for (const candidate of result.candidates) {
      expect(candidate.scrydexCardId).toMatch(/^mock-/);
      // The id prefix marks the row for developers; the NAME is what a human
      // reviewing the app actually reads. A client mistook unlabelled mock
      // candidates for a broken Scrydex integration on 2026-08-01, so the
      // on-screen label is now part of the contract.
      expect(candidate.name).toMatch(/SAMPLE DATA/);
    }
    // Best match first, mirroring Scrydex's contract.
    const scores = result.candidates.map((c) => c.matchScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("mock prices are deterministic within a day and plausibly bounded", () => {
    const a = ScrydexMock.getPrice("mock-base1-4");
    const b = ScrydexMock.getPrice("mock-base1-4");
    expect(a.price).toBe(b.price);
    expect(a.price).toBeGreaterThan(0);
    expect(a.price).toBeLessThan(1000);
    expect(a.currency).toBe("USD");
  });
});
