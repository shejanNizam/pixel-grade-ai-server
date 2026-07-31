import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { CardGame } from "../../modules/card/card.interface";

/**
 * Which Scrydex catalogue backs each of our games.
 *
 * The client's brief (2026-07-31): "integrate Pokémon only for now, but
 * structure the integration so we can easily expand to other trading card games
 * through Scrydex in the future without needing to rebuild it." This table is
 * that seam — every Scrydex call derives its path and its Vision slug from
 * here, so turning a game on is editing one row, not touching call sites.
 *
 * Two facts worth knowing before promising a client any particular game:
 *
 * 1. Scrydex does NOT cover Yu-Gi-Oh! or sports cards. Both `/yugioh/v1/cards`
 *    and `/sports/v1/cards` 404 (probed 2026-07-31). They are in our `CardGame`
 *    enum because the UI lists them as "Coming Soon", but shipping them needs a
 *    second vendor, not a flag flip here.
 * 2. Scrydex covers four games we do not model at all — see
 *    SCRYDEX_UNMAPPED_GAMES. Adding one is a CardGame enum value plus a row
 *    below plus a "Coming Soon" removal on the frontend.
 */

export interface ScrydexGameConfig {
  /**
   * Path segment on api.scrydex.com, e.g. `pokemon` → `/pokemon/v1/cards`.
   * Null when Scrydex has no catalogue for the game at all.
   */
  pathSegment: string | null;
  /** Value for Vision's `games[]` filter. Same string as the path segment. */
  visionSlug: string | null;
  /**
   * Whether we serve this game today. Kept separate from `pathSegment` on
   * purpose: Magic is fully available at Scrydex but not yet enabled for us, so
   * "no path" and "not switched on" are different failures and get different
   * messages.
   */
  live: boolean;
  /** Shown to users, so it carries the accents the marketing copy uses. */
  label: string;
}

export const SCRYDEX_GAMES: Record<CardGame, ScrydexGameConfig> = {
  [CardGame.pokemon]: {
    pathSegment: "pokemon",
    visionSlug: "pokemon",
    live: true,
    label: "Pokémon",
  },
  [CardGame.magic]: {
    // Verified live at Scrydex; switch `live` to true when the client asks for
    // it. Nothing else needs to change.
    pathSegment: "magicthegathering",
    visionSlug: "magicthegathering",
    live: false,
    label: "Magic: The Gathering",
  },
  [CardGame.yugioh]: {
    pathSegment: null,
    visionSlug: null,
    live: false,
    label: "Yu-Gi-Oh!",
  },
  [CardGame.sports]: {
    pathSegment: null,
    visionSlug: null,
    live: false,
    label: "Sports",
  },
};

/**
 * Scrydex catalogues that have no `CardGame` to map onto yet. Verified to
 * respond 200 on 2026-07-31. Documented so the expansion path is a known
 * quantity rather than something to re-discover.
 */
export const SCRYDEX_UNMAPPED_GAMES = [
  "lorcana",
  "onepiece",
  "gundam",
  "riftbound",
] as const;

/**
 * Resolves the Scrydex path segment for a game, or throws the specific reason
 * it cannot be served.
 *
 * Throwing here rather than letting the request 404 is what keeps a user who
 * picked Yu-Gi-Oh! from seeing "Identification service returned 404" — which
 * reads like an outage and would send them to support.
 */
export const requireGameSegment = (game: CardGame): string => {
  const config = SCRYDEX_GAMES[game];

  if (!config) {
    throw new AppError(httpStatus.BAD_REQUEST, `Unknown card game: ${game}`);
  }

  if (!config.pathSegment) {
    throw new AppError(
      httpStatus.NOT_IMPLEMENTED,
      `${config.label} is not covered by our card data provider yet. Pokémon is the only game available today.`,
    );
  }

  if (!config.live) {
    throw new AppError(
      httpStatus.NOT_IMPLEMENTED,
      `${config.label} is coming soon. Pokémon is the only game available today.`,
    );
  }

  return config.pathSegment;
};

/** The Vision `games[]` filter for a game. Same gating as above. */
export const requireVisionSlug = (game: CardGame): string => {
  requireGameSegment(game);
  return SCRYDEX_GAMES[game].visionSlug as string;
};

/** Games a user may actually scan. Drives the UI's "Coming Soon" flags. */
export const liveGames = (): CardGame[] =>
  (Object.keys(SCRYDEX_GAMES) as CardGame[]).filter(
    (game) => SCRYDEX_GAMES[game].live,
  );
