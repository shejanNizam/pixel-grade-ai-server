import crypto from "crypto";
import { configs } from "../config/index";
import { CardGame } from "../modules/card/card.interface";
import { PriceSource } from "../modules/price/price.interface";
import { logger } from "../utils/logger";
import type { IdentificationResult } from "./identification.provider";
import type { PriceQuote } from "./pricing.provider";

/**
 * ⚠️ DEV-ONLY SCRYDEX MOCK — identification + pricing.
 *
 * Exists so frontend integration of the scan flow (including the
 * confirmation screen, which does not exist yet) and the price tracker can
 * proceed while the client's Scrydex credentials are pending
 * (decision 2026-07-19: credentials arrive AFTER site development completes).
 *
 * DOUBLE-GATED: `MOCK_SCRYDEX=true` in the env AND `NODE_ENV=development` —
 * the NODE_ENV half is enforced inside config/index.ts, so `enabled()` can
 * never be true in production no matter what the env file says.
 *
 * Every fabricated record is marked: card ids carry a `mock-` prefix. If one
 * ever shows up outside a dev database, that prefix is the tell.
 *
 * CLAUDE.md forbids stubs that fabricate plausible data precisely because
 * they flow through confirmation into permanent reports. This mock is the
 * sanctioned exception: loud, explicitly opted into, dev-only, and marked.
 */

const enabled = (): boolean => configs.SCRYDEX.mock;

/** Logged once per boot path, so a dev seeing fake candidates knows why. */
let announced = false;
const announce = () => {
  if (announced) return;
  announced = true;
  logger.warn(
    "⚠️ MOCK_SCRYDEX is active — identification and pricing return fabricated dev data",
  );
};

// Real, well-known cards with stable public images (Pokémon TCG API CDN), so
// the confirmation screen renders realistically. Ids are mock-prefixed.
const MOCK_CANDIDATES = [
  {
    scrydexCardId: "mock-base1-4",
    name: "Charizard",
    game: CardGame.pokemon,
    language: "English",
    releaseYear: 1999,
    setExpansion: "Base Set",
    cardNumber: "4/102",
    rarity: "Holo Rare",
    officialImageUrl: "https://images.pokemontcg.io/base1/4_hires.png",
    // Scrydex's real scale is ~0.7–1.3+ and unbounded — mimic it faithfully
    // so nobody renders it as a percentage during integration.
    matchScore: 1.12,
  },
  {
    scrydexCardId: "mock-base1-58",
    name: "Pikachu",
    game: CardGame.pokemon,
    language: "English",
    releaseYear: 1999,
    setExpansion: "Base Set",
    cardNumber: "58/102",
    rarity: "Common",
    officialImageUrl: "https://images.pokemontcg.io/base1/58_hires.png",
    matchScore: 0.94,
  },
  {
    scrydexCardId: "mock-base1-2",
    name: "Blastoise",
    game: CardGame.pokemon,
    language: "English",
    releaseYear: 1999,
    setExpansion: "Base Set",
    cardNumber: "2/102",
    rarity: "Holo Rare",
    officialImageUrl: "https://images.pokemontcg.io/base1/2_hires.png",
    matchScore: 0.81,
  },
];

const identify = (game: CardGame): IdentificationResult => {
  announce();
  return {
    candidates: MOCK_CANDIDATES.map((c) => ({ ...c, game })),
    languageCode: "en",
  };
};

/**
 * Deterministic pseudo-market price: a stable per-card base plus a daily
 * drift, so repeated daily refreshes build a history that actually moves —
 * which is what the sparklines and change-percent columns need to demo.
 */
const getPrice = (scrydexCardId: string): PriceQuote => {
  announce();

  const hash = crypto.createHash("sha256").update(scrydexCardId).digest();
  const base = 15 + (hash.readUInt16BE(0) % 385); // $15–$400 per card, stable

  // Day-indexed drift: ±8% swing over a ~2-week cycle plus small daily noise.
  const day = Math.floor(Date.now() / 86_400_000);
  const salt = hash.readUInt16BE(2);
  const cycle = Math.sin((day + salt) / 4.5) * 0.08;
  const noise = (((salt ^ day) % 21) - 10) / 500; // ±2%
  const price = Number((base * (1 + cycle + noise)).toFixed(2));

  return {
    price,
    currency: "USD",
    source: PriceSource.scrydex,
    capturedAt: new Date(),
  };
};

export const ScrydexMock = {
  enabled,
  identify,
  getPrice,
};
