import { CardGame, PriceBasis } from "../app/modules/card/card.interface";
import {
  SCRYDEX_GAMES,
  requireGameSegment,
  requireVisionSlug,
} from "../app/services/scrydex/scrydex.games";
import {
  parseYear,
  pickImageUrl,
  selectQuote,
  toIdentifiedCards,
} from "../app/services/scrydex/scrydex.mapper";
import type { ScrydexCard } from "../app/services/scrydex/scrydex.types";

/**
 * Scrydex mapping.
 *
 * The fixtures below are trimmed copies of real `api.scrydex.com` responses
 * captured on 2026-07-31, not invented shapes — including the parts that look
 * like mistakes. `base1-4`'s 1st Edition Shadowless printing really does report
 * $250 Near Mint and $10,000 Moderately Played, and that pair is the whole
 * reason condition ranking beats "take the biggest number".
 *
 * These assertions guard money on a user's dashboard. A wrong variant or a
 * wrong condition does not throw — it prints a plausible figure that is off by
 * an order of magnitude, which nobody notices until a collector prices a sale
 * off it.
 */

/** Trimmed from GET /pokemon/v1/cards?q=name:charizard expansion.id:base1 */
const charizard: ScrydexCard = {
  id: "base1-4",
  name: "Charizard",
  printed_number: "4/102",
  rarity: "Holo Rare",
  language: "English",
  images: [
    { type: "front", small: "s.png", medium: "m.png", large: "l.png" },
  ],
  expansion: { id: "base1", name: "Base Set", release_date: "1999/01/09" },
  variants: [
    {
      name: "firstEditionShadowlessHolofoil",
      prices: [
        { condition: "NM", type: "raw", market: 250.0, currency: "USD" },
        // Vendor noise: an MP copy priced 40× the NM copy.
        { condition: "MP", type: "raw", market: 10000.0, currency: "USD" },
        { condition: "DM", type: "raw", market: 4200.0, currency: "USD" },
      ],
    },
    {
      name: "jumbo",
      prices: [
        { condition: "NM", type: "raw", low: 500.0, market: 400.0, currency: "USD" },
      ],
    },
    {
      name: "unlimitedHolofoil",
      prices: [
        { condition: "NM", type: "raw", low: 919.49, market: 800.43, currency: "USD" },
        { condition: "LP", type: "raw", low: 510.0, market: 510.07, currency: "USD" },
      ],
    },
  ],
};

describe("Scrydex price selection", () => {
  it("prefers the variant Vision actually matched", () => {
    const quote = selectQuote(charizard, {
      preferredVariant: "firstEditionShadowlessHolofoil",
    });
    expect(quote?.variantName).toBe("firstEditionShadowlessHolofoil");
    expect(quote?.price).toBe(250);
  });

  it("takes the best condition, not the biggest number", () => {
    // $10,000 MP sits in the same variant. Taking a max() would put it on the
    // user's dashboard; Near Mint is what "the price of this card" means.
    const quote = selectQuote(charizard, {
      preferredVariant: "firstEditionShadowlessHolofoil",
    });
    expect(quote?.condition).toBe("NM");
    expect(quote?.price).toBe(250);
  });

  it("falls back to a standard printing, never a jumbo or metal replica", () => {
    // No variant known. `jumbo` is an A3 box-topper — a different object from
    // the card in the user's hand — so it must never win a fallback.
    const quote = selectQuote(charizard);
    expect(quote?.variantName).toBe("unlimitedHolofoil");
  });

  it("matches variant names case- and punctuation-insensitively", () => {
    const quote = selectQuote(charizard, {
      preferredVariant: "Unlimited Holofoil",
    });
    expect(quote?.variantName).toBe("unlimitedHolofoil");
  });

  it("labels every quote with its basis", () => {
    // CLAUDE.md invariant #9 — a figure without its basis is worse than none.
    const quote = selectQuote(charizard);
    expect(quote?.basis).toBe(PriceBasis.raw);
    expect(quote?.gradeRef).toBeUndefined();
  });

  describe("graded comps", () => {
    // Live since the Growth upgrade (2026-08-04) — Base Set alone returns
    // ~3,700 graded prices across PSA, CGC, BGS, SGC, TAG, ACE and others.
    // Still not wired to the UI: which grade to quote is an open client
    // decision (OPEN-QUESTIONS §C), so these pin the mapping, not the product.
    const gradedOnly: ScrydexCard = {
      id: "x",
      variants: [
        {
          name: "normal",
          prices: [
            { type: "graded", company: "PSA", grade: "9", market: 900, currency: "USD" },
            { type: "graded", company: "PSA", grade: "10", market: 2567.88, currency: "USD" },
          ],
        },
      ],
    };

    it("reads as graded, with the company and grade attached", () => {
      const quote = selectQuote(gradedOnly, { preferGraded: true });
      expect(quote?.basis).toBe(PriceBasis.graded);
      expect(quote?.gradeRef).toBe("PSA 10");
      expect(quote?.price).toBe(2567.88);
    });

    it("prefers the benchmark grader over a higher grade from a minor one", () => {
      // Scrydex returns a long tail of graders. A BCCG 10 is not what anyone
      // means by "the graded price" — PSA sets the market and the rest trade
      // at a discount, so company outranks grade.
      const quote = selectQuote(
        {
          id: "x",
          variants: [
            {
              name: "normal",
              prices: [
                { type: "graded", company: "BCCG", grade: "10", market: 400, currency: "USD" },
                { type: "graded", company: "TAG", grade: "10", market: 550, currency: "USD" },
                { type: "graded", company: "PSA", grade: "9", market: 900, currency: "USD" },
              ],
            },
          ],
        },
        { preferGraded: true },
      );
      expect(quote?.gradeRef).toBe("PSA 9");
    });

    it("never silently substitutes a graded comp for a raw one", () => {
      // The whole point of invariant #9: the two differ by multiples. A card
      // whose basis flipped between refreshes would write market movement into
      // the price history that never happened. No raw price means no price.
      expect(selectQuote(gradedOnly)).toBeNull();
    });
  });

  it("ignores signed and misprinted comps", () => {
    // An autographed Charizard trades on its own market and is not evidence of
    // what an ordinary copy is worth.
    const quote = selectQuote({
      id: "x",
      variants: [
        {
          name: "normal",
          prices: [
            { condition: "NM", type: "raw", market: 9999, is_signed: true },
            { condition: "NM", type: "raw", market: 8888, is_error: true },
            { condition: "LP", type: "raw", market: 42, currency: "USD" },
          ],
        },
      ],
    });
    expect(quote?.price).toBe(42);
  });

  it("prefers market over low, which the feed sometimes reports above it", () => {
    const quote = selectQuote(charizard, {
      preferredVariant: "unlimitedHolofoil",
    });
    expect(quote?.price).toBe(800.43); // not the 919.49 `low`
  });

  it("returns null rather than a zero when a card has no quotable price", () => {
    // A sweep over a thousand cards must treat this as a skip, not a $0 write.
    expect(selectQuote({ id: "x", variants: [{ name: "normal", prices: [] }] })).toBeNull();
    expect(selectQuote({ id: "x", variants: [] })).toBeNull();
    expect(selectQuote(undefined)).toBeNull();
  });
});

describe("Scrydex card mapping", () => {
  it("keeps the printed number, falling back to the internal one", () => {
    const [card] = toIdentifiedCards(
      [{ score: 1.12, variant: "unlimitedHolofoil", card: charizard }],
      CardGame.pokemon,
    );
    expect(card.cardNumber).toBe("4/102");

    // Modern and digital-only sets null `printed_number`.
    const [modern] = toIdentifiedCards(
      [{ score: 1, card: { id: "tcgp-B2b-9", number: "9", printed_number: null } }],
      CardGame.pokemon,
    );
    expect(modern.cardNumber).toBe("9");
  });

  it("carries the matched variant through to the catalogue", () => {
    // Without this the card is priced off a guessed printing forever after.
    const [card] = toIdentifiedCards(
      [{ score: 1.12, variant: "unlimitedHolofoil", card: charizard }],
      CardGame.pokemon,
    );
    expect(card.scrydexVariant).toBe("unlimitedHolofoil");
  });

  it("sorts candidates best-first and drops matches without an id", () => {
    const cards = toIdentifiedCards(
      [
        { score: 0.81, card: { id: "base1-2", name: "Blastoise" } },
        { score: 1.12, card: { id: "base1-4", name: "Charizard" } },
        // No id — cannot be upserted or confirmed against, so unusable.
        { score: 1.3, card: { name: "Ghost" } },
      ],
      CardGame.pokemon,
    );
    expect(cards.map((c) => c.scrydexCardId)).toEqual(["base1-4", "base1-2"]);
  });

  it("parses the vendor's slash-separated release dates", () => {
    expect(parseYear("1999/01/09")).toBe(1999);
    expect(parseYear("2026-03-25")).toBe(2026);
    expect(parseYear(undefined)).toBeUndefined();
    expect(parseYear("not a date")).toBeUndefined();
  });

  it("picks the large front image — the slab prints it at 300 DPI", () => {
    expect(pickImageUrl(charizard)).toBe("l.png");
    expect(pickImageUrl({ images: [{ type: "front", small: "s.png" }] })).toBe("s.png");
    expect(pickImageUrl({ images: [] })).toBeUndefined();
  });
});

describe("Scrydex game registry", () => {
  it("serves Pokémon", () => {
    expect(requireGameSegment(CardGame.pokemon)).toBe("pokemon");
    expect(requireVisionSlug(CardGame.pokemon)).toBe("pokemon");
  });

  it("refuses games Scrydex has no catalogue for, by name", () => {
    // /yugioh/v1/cards and /sports/v1/cards both 404 — shipping them needs a
    // second vendor, so the message must not read like a transient outage.
    expect(() => requireGameSegment(CardGame.yugioh)).toThrow(/not covered/);
    expect(() => requireGameSegment(CardGame.sports)).toThrow(/not covered/);
  });

  it("distinguishes 'not switched on' from 'no catalogue'", () => {
    // Magic is fully available at Scrydex, just not enabled for us — a
    // different fix, so a different message.
    expect(SCRYDEX_GAMES[CardGame.magic].pathSegment).toBe("magicthegathering");
    expect(() => requireGameSegment(CardGame.magic)).toThrow(/coming soon/i);
  });
});
