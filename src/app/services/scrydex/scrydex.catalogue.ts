import { CardGame } from "../../modules/card/card.interface";
import { request } from "./scrydex.client";
import { requireGameSegment } from "./scrydex.games";
import type {
  ScrydexCard,
  ScrydexList,
  ScrydexPriceHistoryPoint,
  ScrydexSingle,
} from "./scrydex.types";

/**
 * Scrydex catalogue reads — cards, prices, price history.
 *
 * The batch lookup below is the single most important thing in this file. A
 * per-card fetch costs 1 credit; `getCardsWithPrices` fetches up to 100 cards
 * for the same 1 credit via the `q=id:a OR id:b` search syntax. On the client's
 * Starter plan (5,000 credits/month) that is the difference between the daily
 * price sweep costing 30,000 credits a month and costing 300.
 *
 * Never replace a batch call with a loop of single calls "for simplicity" — the
 * budget is the design constraint here, not the code shape.
 */

/** Scrydex's own cap. Asking for more silently returns 100. */
export const SCRYDEX_MAX_PAGE_SIZE = 100;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * One card with its prices attached.
 *
 * `include=prices` is what makes the `variants[].prices` array non-empty; the
 * same request without it returns variants with `prices: []` and costs the same
 * credit, so there is no reason to fetch a card for pricing without it.
 */
export const getCardWithPrices = async (
  game: CardGame,
  scrydexCardId: string,
): Promise<ScrydexCard | null> => {
  const segment = requireGameSegment(game);

  const payload = await request<
    ScrydexSingle<ScrydexCard> | ScrydexList<ScrydexCard>
  >(`/${segment}/v1/cards/${encodeURIComponent(scrydexCardId)}`, {
    query: { include: "prices" },
    operation: `Card lookup (${scrydexCardId})`,
  });

  // Scrydex returns a bare object here and an array from the search endpoint.
  // Normalising both shapes means callers never have to care which one they hit.
  const data = payload.data;
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
};

/**
 * Many cards with prices, batched.
 *
 * Ids are ORed into a single Lucene query, 100 per request. Cards Scrydex does
 * not know about are simply absent from the result — the caller gets a Map and
 * decides what a miss means, because a miss during a price sweep is routine
 * (a delisted id) while a miss during a lookup is an error.
 */
export const getCardsWithPrices = async (
  game: CardGame,
  scrydexCardIds: string[],
): Promise<Map<string, ScrydexCard>> => {
  const segment = requireGameSegment(game);
  const found = new Map<string, ScrydexCard>();

  const ids = [...new Set(scrydexCardIds.filter(Boolean))];
  if (ids.length === 0) return found;

  for (const batch of chunk(ids, SCRYDEX_MAX_PAGE_SIZE)) {
    // Ids can contain characters the query parser treats specially (Scrydex ids
    // are `set-number`, and the hyphen is fine, but quoting costs nothing and
    // guards against future id formats).
    const q = batch.map((id) => `id:"${id}"`).join(" OR ");

    const payload = await request<ScrydexList<ScrydexCard>>(
      `/${segment}/v1/cards`,
      {
        query: {
          q,
          include: "prices",
          // Trimming the payload to what pricing actually reads. Purely a
          // bandwidth/parse win — `select` does not change the credit cost.
          select: "id,name,variants",
          page_size: SCRYDEX_MAX_PAGE_SIZE,
        },
        operation: `Batch card lookup (${batch.length} cards)`,
      },
    );

    for (const card of payload.data ?? []) {
      if (card.id) found.set(card.id, card);
    }
  }

  return found;
};

/**
 * How much history to pull when seeding a card, in days.
 *
 * ⚠️ One point per day and `page_size` caps at 100, so this is also the page
 * limit: asking for 365 days returns the first 100 and silently drops the rest.
 * 90 days is a deliberate stop at one page — it fills the 24h, 7d, and 30d
 * charts completely for **one credit**, and the 1y chart (which buckets by
 * month) starts with a real three-month curve and extends itself as the daily
 * sweep runs.
 *
 * Pulling a genuine year means paginating at 1 credit per 100 days, i.e. 4×
 * the cost per card. On a 5,000-credit/month plan that is a budget decision,
 * not a tuning knob — see `pages` below.
 */
export const PRICE_HISTORY_DAYS = 90;

/**
 * Historical daily prices for one card, newest page first.
 *
 * Seeds a card's history the first time we see it so the price tracker draws a
 * real sparkline immediately, instead of a flat line that only becomes a chart
 * a month after launch.
 *
 * `pages` costs one credit each. Left at 1 by default; raise it only with the
 * per-card cost in front of you.
 */
export const getPriceHistory = async (
  game: CardGame,
  scrydexCardId: string,
  days = PRICE_HISTORY_DAYS,
  pages = 1,
): Promise<ScrydexPriceHistoryPoint[]> => {
  const segment = requireGameSegment(game);
  const points: ScrydexPriceHistoryPoint[] = [];

  for (let page = 1; page <= pages; page += 1) {
    const payload = await request<ScrydexList<ScrydexPriceHistoryPoint>>(
      `/${segment}/v1/cards/${encodeURIComponent(scrydexCardId)}/price_history`,
      {
        query: { days, page, page_size: SCRYDEX_MAX_PAGE_SIZE },
        operation: `Price history (${scrydexCardId}, page ${page})`,
      },
    );

    const batch = payload.data ?? [];
    points.push(...batch);

    // Short page means the archive is exhausted — stop before spending another
    // credit on a page that cannot exist.
    if (batch.length < SCRYDEX_MAX_PAGE_SIZE) break;
  }

  return points;
};

/**
 * Free-text catalogue search against Scrydex.
 *
 * Not wired to a route today — our own `GET /card` searches the local
 * catalogue, which is deliberately a cache of what has actually been scanned.
 * Exposed here so "let users add a card they haven't scanned" is a route away,
 * without anyone needing to re-derive the query syntax.
 */
export const searchCards = async (
  game: CardGame,
  searchTerm: string,
  options: { page?: number; pageSize?: number; withPrices?: boolean } = {},
): Promise<{ cards: ScrydexCard[]; total: number }> => {
  const segment = requireGameSegment(game);

  const payload = await request<ScrydexList<ScrydexCard>>(
    `/${segment}/v1/cards`,
    {
      query: {
        // Wildcard suffix so "char" finds Charizard — Scrydex's `q` is exact
        // on whole terms otherwise.
        q: `name:${JSON.stringify(searchTerm)}*`,
        page: options.page ?? 1,
        page_size: Math.min(options.pageSize ?? 20, SCRYDEX_MAX_PAGE_SIZE),
        include: options.withPrices ? "prices" : undefined,
      },
      operation: `Card search (${searchTerm})`,
    },
  );

  return { cards: payload.data ?? [], total: payload.total_count ?? 0 };
};

export const ScrydexCatalogue = {
  getCardWithPrices,
  getCardsWithPrices,
  getPriceHistory,
  searchCards,
};
