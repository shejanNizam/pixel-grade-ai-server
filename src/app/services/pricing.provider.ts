import { CardGame, PriceBasis } from "../modules/card/card.interface";
import { PriceSource } from "../modules/price/price.interface";
import { logger } from "../utils/logger";
import { ScrydexCatalogue } from "./scrydex/scrydex.catalogue";
import { isConfigured as scrydexIsConfigured } from "./scrydex/scrydex.client";
import { selectQuote } from "./scrydex/scrydex.mapper";
import { ScrydexMock } from "./scrydex.mock";

/**
 * Market pricing — Scrydex, on the same credentials as identification.
 *
 * Every quote costs 1 Scrydex credit, drawn from the same monthly pool that
 * funds Vision at 5 credits per scan. Pricing and scanning are in direct
 * competition for one budget, which is why `getPrices` (batched, 100 cards per
 * credit) exists alongside `getPrice` and why the daily sweep uses it.
 *
 * A per-card miss returns null rather than throwing: plenty of cards genuinely
 * have no quotable price, and one of them must not abort a sweep over hundreds.
 * Vendor-level failures (auth, network, 5xx) still throw — those are not misses.
 */

export interface PriceQuote {
  price: number;
  currency: string;
  source: PriceSource;
  capturedAt: Date;
  /**
   * Whether the figure is a raw or a graded comp. Never drop this on the way to
   * the UI — CLAUDE.md invariant #9: a market value is never rendered without
   * its basis, because the two differ by multiples for the same card.
   *
   * Everything this account's plan returns today is `raw` (480 price objects
   * sampled across five expansions on 2026-07-31, zero graded).
   */
  basis: PriceBasis;
  /** "PSA 10" when `basis` is graded. Undefined for raw. */
  gradeRef?: string;
  /** "NM" etc. when raw. Undefined for graded, which has a grade instead. */
  condition?: string;
  /**
   * The printing the figure came from, e.g. "unlimitedHolofoil".
   *
   * Written back onto the card so the next refresh prices the same printing. A
   * card whose variant silently drifts between refreshes produces a price
   * history where the jumps are our own bookkeeping, not the market.
   */
  variantName?: string;
}

/**
 * Pricing is configured exactly when Scrydex is.
 *
 * There is no separate PRICING_API_KEY any more — Scrydex covers pricing on the
 * same credentials, and the old check meant the daily sweep silently skipped
 * every run while the unused key sat empty.
 */
const isConfigured = (): boolean =>
  ScrydexMock.pricingEnabled() || scrydexIsConfigured();

/** One card. Prefer `getPrices` for anything that loops. */
const getPrice = async (
  scrydexCardId: string,
  game: CardGame = CardGame.pokemon,
  preferredVariant?: string,
): Promise<PriceQuote | null> => {
  if (ScrydexMock.pricingEnabled()) return ScrydexMock.getPrice(scrydexCardId);

  const card = await ScrydexCatalogue.getCardWithPrices(game, scrydexCardId);
  if (!card) return null;

  const selected = selectQuote(card, { preferredVariant });
  if (!selected) return null;

  return {
    price: selected.price,
    currency: selected.currency,
    source: PriceSource.scrydex,
    capturedAt: new Date(),
    basis: selected.basis,
    gradeRef: selected.gradeRef,
    condition: selected.condition,
    variantName: selected.variantName,
  };
};

/**
 * Many cards in one round trip — 100 per Scrydex credit instead of one.
 *
 * This is what makes a daily sweep affordable on the Starter plan: 1,000 cards
 * costs 10 credits here against 1,000 credits card-by-card. Cards Scrydex has
 * no price for are simply absent from the returned map.
 */
const getPrices = async (
  cards: { scrydexCardId: string; game: CardGame; scrydexVariant?: string }[],
): Promise<Map<string, PriceQuote>> => {
  const quotes = new Map<string, PriceQuote>();
  if (cards.length === 0) return quotes;

  if (ScrydexMock.pricingEnabled()) {
    for (const card of cards) {
      quotes.set(card.scrydexCardId, ScrydexMock.getPrice(card.scrydexCardId));
    }
    return quotes;
  }

  // Scrydex's catalogues are per-game paths, so a mixed batch has to be split
  // by game before it can be batched by id.
  const byGame = new Map<CardGame, typeof cards>();
  for (const card of cards) {
    const bucket = byGame.get(card.game) ?? [];
    bucket.push(card);
    byGame.set(card.game, bucket);
  }

  const capturedAt = new Date();

  for (const [game, gameCards] of byGame) {
    let fetched;
    try {
      fetched = await ScrydexCatalogue.getCardsWithPrices(
        game,
        gameCards.map((card) => card.scrydexCardId),
      );
    } catch (error) {
      // One game failing (an unsupported game slipped into the catalogue, a
      // transient 502) must not cost us the games that would have succeeded.
      logger.error("Batch price lookup failed for a game", { game, error });
      continue;
    }

    for (const card of gameCards) {
      const vendorCard = fetched.get(card.scrydexCardId);
      if (!vendorCard) continue;

      const selected = selectQuote(vendorCard, {
        preferredVariant: card.scrydexVariant,
      });
      if (!selected) continue;

      quotes.set(card.scrydexCardId, {
        price: selected.price,
        currency: selected.currency,
        source: PriceSource.scrydex,
        // One timestamp for the whole sweep, so a batch lands as a single
        // column in the history rather than smeared across the minutes the
        // sweep took to run.
        capturedAt,
        basis: selected.basis,
        gradeRef: selected.gradeRef,
        condition: selected.condition,
        variantName: selected.variantName,
      });
    }
  }

  return quotes;
};

/**
 * Past daily prices for one card, oldest first.
 *
 * Seeds a card's history the first time we see it so the price tracker draws a
 * real 30-day sparkline immediately, instead of a flat line that only becomes a
 * chart a month after launch. One credit, ~90 days — see PRICE_HISTORY_DAYS for
 * why it stops there rather than pulling a full year.
 *
 * Each day in the feed carries every variant/condition combination, so the same
 * `selectQuote` rules that pick today's price pick each historical day's — the
 * history and the current price must be measuring the same printing or the
 * change percentages are fiction.
 */
const getPriceHistory = async (
  scrydexCardId: string,
  game: CardGame = CardGame.pokemon,
  options: { days?: number; pages?: number; preferredVariant?: string } = {},
): Promise<PriceQuote[]> => {
  if (ScrydexMock.pricingEnabled()) return [];

  const points = await ScrydexCatalogue.getPriceHistory(
    game,
    scrydexCardId,
    options.days,
    options.pages,
  );

  const quotes: PriceQuote[] = [];

  for (const point of points) {
    if (!point.date || !point.prices?.length) continue;

    // The history endpoint flattens variants into each price row, so rebuild
    // the variant grouping `selectQuote` expects rather than duplicating its
    // condition and basis rules here.
    const grouped = new Map<string, typeof point.prices>();
    for (const price of point.prices) {
      const key = price.variant ?? "";
      const bucket = grouped.get(key) ?? [];
      bucket.push(price);
      grouped.set(key, bucket);
    }

    const selected = selectQuote(
      {
        variants: [...grouped].map(([name, prices]) => ({ name, prices })),
      },
      { preferredVariant: options.preferredVariant },
    );
    if (!selected) continue;

    // Scrydex dates are "YYYY/MM/DD". Parsed as UTC midnight so a point does
    // not drift across a day boundary depending on server timezone.
    const capturedAt = new Date(`${point.date.replace(/\//g, "-")}T00:00:00Z`);
    if (Number.isNaN(capturedAt.getTime())) continue;

    quotes.push({
      price: selected.price,
      currency: selected.currency,
      source: PriceSource.scrydex,
      capturedAt,
      basis: selected.basis,
      gradeRef: selected.gradeRef,
      condition: selected.condition,
      variantName: selected.variantName,
    });
  }

  return quotes.sort(
    (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
  );
};

export const PricingProvider = {
  getPrice,
  getPrices,
  getPriceHistory,
  isConfigured,
};
