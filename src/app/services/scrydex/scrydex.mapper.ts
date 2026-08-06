import { CardGame, PriceBasis } from "../../modules/card/card.interface";
import type {
  ScrydexCard,
  ScrydexPrice,
  ScrydexVariant,
  ScrydexVisionMatch,
} from "./scrydex.types";

/**
 * Vendor shapes → our shapes.
 *
 * Kept apart from the client so the two hard decisions in this integration —
 * which of a card's many prices *is* the price, and how a Vision match becomes
 * a catalogue row — are readable in one file and testable without a network.
 */

/* ------------------------------------------------------------------- Cards */

export interface IdentifiedCard {
  scrydexCardId: string;
  name: string;
  game: CardGame;
  language?: string;
  releaseYear?: number;
  setExpansion?: string;
  cardNumber?: string;
  rarity?: string;
  officialImageUrl?: string;
  /**
   * Which printing Vision matched, e.g. "unlimitedHolofoil".
   *
   * Carried all the way to the catalogue because pricing is meaningless without
   * it: Base Set Pikachu has eleven variants and their NM market prices span
   * two orders of magnitude. A card id alone does not identify a price.
   */
  scrydexVariant?: string;
  /**
   * Scrydex's raw confidence. Its scale is roughly 0.7–1.3+, NOT a percentage —
   * higher is better, and it is not bounded at 1. Stored verbatim and used for
   * ranking only. Do not render it as "N% match".
   */
  matchScore: number;
}

/** Scrydex dates are "YYYY/MM/DD", so this works for both that and ISO. */
export const parseYear = (releaseDate?: string): number | undefined => {
  if (!releaseDate) return undefined;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : undefined;
};

/**
 * Picks the best available artwork.
 *
 * Prefers `large` — the slab's `catalogue` render mode prints this at 300 DPI,
 * and a `small` thumbnail upscaled to a 65×90 mm window is visibly mushy.
 * Front-facing images win over backs and alternates.
 */
export const pickImageUrl = (card?: ScrydexCard): string | undefined => {
  const images = card?.images ?? [];
  const front = images.find((image) => image.type === "front") ?? images[0];
  return front?.large ?? front?.medium ?? front?.small;
};

/** Vendor card (from Vision or the catalogue) → the fields our Card model holds. */
export const toIdentifiedCard = (
  card: ScrydexCard | undefined,
  game: CardGame,
  extras: { matchScore?: number; variant?: string } = {},
): IdentifiedCard | null => {
  // Without an id there is nothing to upsert against or confirm later, so the
  // match is unusable rather than merely incomplete.
  if (!card?.id) return null;

  return {
    scrydexCardId: card.id,
    name: card.name ?? "Unknown card",
    game,
    language: card.language,
    releaseYear: parseYear(card.expansion?.release_date),
    setExpansion: card.expansion?.name,
    // `printed_number` is what a collector reads off the card ("4/102"), but it
    // is null on modern and digital-only sets where `number` is all there is.
    cardNumber: card.printed_number ?? card.number,
    rarity: card.rarity,
    officialImageUrl: pickImageUrl(card),
    // Vision reports `variant: null` on most matches and a real name on a few
    // (verified 2026-08-06: 10 candidates, 1 named). Normalised to undefined so
    // a null is never persisted — an absent variant must fall through to
    // selectQuote's preference order, and `applyQuote` writes back whichever
    // printing actually got priced, so the row self-corrects on first refresh.
    scrydexVariant: extras.variant ?? undefined,
    matchScore: extras.matchScore ?? 0,
  };
};

export const toIdentifiedCards = (
  matches: ScrydexVisionMatch[],
  game: CardGame,
  fallbackLanguage?: string,
): IdentifiedCard[] => {
  const candidates = matches
    .map((match) =>
      toIdentifiedCard(match.card, game, {
        matchScore: match.score ?? 0,
        variant: match.variant,
      }),
    )
    .filter((card): card is IdentifiedCard => card !== null)
    .map((card) => ({
      ...card,
      language: card.language ?? fallbackLanguage,
    }));

  // Scrydex documents matches as already sorted by confidence, but the
  // confirmation screen's "best match" depends on it, so sort defensively
  // rather than trusting response ordering.
  return candidates.sort((a, b) => b.matchScore - a.matchScore);
};

/* ------------------------------------------------------------------ Prices */

/**
 * Condition preference, best first.
 *
 * "The price of this card" means a Near Mint copy unless nothing better exists.
 * Taking the highest number instead would be actively wrong: the live feed has
 * Base Set Charizard 1st Edition Shadowless at $250 NM and $10,000 MP, which is
 * vendor noise that a max() would promote straight onto a user's dashboard.
 */
const CONDITION_RANK: Record<string, number> = {
  NM: 0,
  LP: 1,
  MP: 2,
  HP: 3,
  DM: 4,
};

/**
 * Which printing to price when we were never told which one the user has.
 *
 * Only consulted as a fallback — the variant Vision reported always wins. The
 * order is "the printing someone means when they name the card": a standard
 * pull before a shadowless before a first edition.
 */
const VARIANT_PREFERENCE = [
  "normal",
  "unlimited",
  "unlimitedholofoil",
  "holofoil",
  "reverseholofoil",
  "unlimitedshadowless",
  "unlimitedshadowlessholofoil",
  "firstedition",
  "firsteditionholofoil",
  "firsteditionshadowless",
  "firsteditionshadowlessholofoil",
];

/**
 * Printings that are a different object from the card in the user's hand.
 *
 * A jumbo box-topper is A3-sized and a metal Celebrations replica is not even
 * cardboard; pricing a scanned Charizard off either is simply the wrong number.
 * They are never chosen as a fallback, but an explicit Vision match still wins.
 */
const VARIANT_DEPRIORITISED = ["jumbo", "jumboalternate", "metal"];

const normaliseVariantName = (name?: string): string =>
  (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface SelectedQuote {
  price: number;
  currency: string;
  basis: PriceBasis;
  /** "NM" for raw. Undefined for graded, which has a grade instead. */
  condition?: string;
  /** "PSA 10" for graded. Undefined for raw. Becomes `card.priceGradeRef`. */
  gradeRef?: string;
  /** Which printing the figure came from. Stored so refreshes stay consistent. */
  variantName?: string;
}

/**
 * The usable figure inside one price object, or null.
 *
 * `market` first — it is the vendor's own reconciled number. `low` is present
 * without `market` on thin listings and is occasionally *above* market when it
 * is present, so it is a fallback, never a tiebreaker.
 */
const priceValue = (price: ScrydexPrice): number | null => {
  const value = price.market ?? price.mid ?? price.low ?? price.high;
  return typeof value === "number" && value > 0 ? value : null;
};

/**
 * Prices we will never quote.
 *
 * A signed card and a misprint each trade on their own market — a Charizard
 * with an autograph is not evidence of what an ordinary Charizard is worth.
 */
const isQuotable = (price: ScrydexPrice): boolean =>
  !price.is_signed && !price.is_error && priceValue(price) !== null;

const rankOf = (price: ScrydexPrice): number =>
  CONDITION_RANK[(price.condition ?? "").toUpperCase()] ?? 99;

/** Best raw quote within a single variant: highest condition wins. */
const bestRawPrice = (variant: ScrydexVariant): ScrydexPrice | null => {
  const usable = (variant.prices ?? []).filter(
    (price) => (price.type ?? "raw") === "raw" && isQuotable(price),
  );

  if (usable.length === 0) return null;

  return usable.reduce((best, price) =>
    rankOf(price) < rankOf(best) ? price : best,
  );
};

/**
 * Grading companies, most authoritative first.
 *
 * Needed because Scrydex returns comps from a long tail of graders — Base Set
 * alone carries PSA, CGC, BGS, SGC, TAG, ACE, AGS, PGC, DGS, BCCG and CCIC
 * (sampled 2026-08-06). "Highest grade wins" on its own would quote a BCCG 10
 * over a PSA 10, which is not the number a collector means by "the graded
 * price": PSA is the market benchmark and the others trade at a discount to it.
 *
 * Unlisted companies still qualify, they just rank last.
 */
const COMPANY_PREFERENCE = ["PSA", "BGS", "CGC", "SGC"];

const companyRank = (price: ScrydexPrice): number => {
  const index = COMPANY_PREFERENCE.indexOf((price.company ?? "").toUpperCase());
  return index === -1 ? COMPANY_PREFERENCE.length : index;
};

/**
 * Best graded quote within a variant: the most authoritative company first,
 * then its highest grade.
 *
 * Company before grade is deliberate — a PSA 9 is a more meaningful reference
 * than a TAG 10.
 *
 * ⚠️ Reachable now (Growth unlocked graded pricing on 2026-08-04) but still not
 * called: `selectQuote` defaults to raw, and **which** grade to quote on a
 * report is an open client decision — the predicted grade, or a fixed reference
 * like PSA 9. See `docs/OPEN-QUESTIONS.md` §C. Do not wire `preferGraded` on
 * without that answer.
 */
const bestGradedPrice = (variant: ScrydexVariant): ScrydexPrice | null => {
  const usable = (variant.prices ?? []).filter(
    (price) => price.type === "graded" && isQuotable(price),
  );

  if (usable.length === 0) return null;

  return usable.reduce((best, price) => {
    const rank = companyRank(price) - companyRank(best);
    if (rank !== 0) return rank < 0 ? price : best;
    return Number(price.grade ?? 0) > Number(best.grade ?? 0) ? price : best;
  });
};

/** Where a variant sits in the fallback order. Lower is better. */
const variantRank = (variant: ScrydexVariant): number => {
  const name = normaliseVariantName(variant.name);

  if (VARIANT_DEPRIORITISED.includes(name)) return 1000;

  const preferred = VARIANT_PREFERENCE.indexOf(name);
  // Unknown variant names sort after every known one but ahead of the
  // deprioritised oddities — an unrecognised standard printing is still a
  // better guess than a jumbo.
  return preferred === -1 ? 500 : preferred;
};

/**
 * Picks the one price that represents this card.
 *
 * Order of decisions, and why each is where it is:
 *
 * 1. **Variant.** If Vision told us which printing it saw, that is the answer —
 *    it looked at the user's actual card. Otherwise fall back to the preference
 *    order above.
 * 2. **Basis.** Raw unless graded was asked for. Invariant #9 in CLAUDE.md: a
 *    market value is never rendered without its basis, and the two differ by
 *    multiples for the same card.
 * 3. **Condition.** Near Mint down to Damaged.
 * 4. **Figure.** Market, then mid/low/high.
 *
 * Returns null rather than throwing when a card has no quotable price at all —
 * plenty of cards genuinely have none, and one of them must not abort a sweep
 * over a thousand others.
 */
export const selectQuote = (
  card: ScrydexCard | undefined,
  options: { preferredVariant?: string; preferGraded?: boolean } = {},
): SelectedQuote | null => {
  const variants = card?.variants ?? [];
  if (variants.length === 0) return null;

  const wanted = normaliseVariantName(options.preferredVariant);
  const pickPrice = options.preferGraded ? bestGradedPrice : bestRawPrice;

  const exact = wanted
    ? variants.find((variant) => normaliseVariantName(variant.name) === wanted)
    : undefined;

  // The variant we were told about wins even if it has no quotable price —
  // but only if it actually has one. A first-edition card whose own printing is
  // unpriced is better served by the unlimited comp than by nothing.
  const ordered = [
    ...(exact ? [exact] : []),
    ...[...variants]
      .filter((variant) => variant !== exact)
      .sort((a, b) => variantRank(a) - variantRank(b)),
  ];

  for (const variant of ordered) {
    const price = pickPrice(variant);
    if (!price) continue;

    const value = priceValue(price);
    if (value === null) continue;

    const graded = price.type === "graded";

    return {
      price: Number(value.toFixed(2)),
      currency: price.currency ?? "USD",
      basis: graded ? PriceBasis.graded : PriceBasis.raw,
      condition: graded ? undefined : price.condition,
      gradeRef:
        graded && price.company
          ? `${price.company} ${price.grade ?? ""}`.trim()
          : undefined,
      variantName: variant.name,
    };
  }

  return null;
};
