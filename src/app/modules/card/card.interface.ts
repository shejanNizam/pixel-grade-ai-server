import { Document, Types } from "mongoose";

/** Only Pokémon is live at launch; the rest are "Coming Soon" in the UI but the
 *  enum carries them so stored data does not need migrating when they ship. */
export enum CardGame {
  pokemon = "pokemon",
  magic = "magic",
  yugioh = "yugioh",
  sports = "sports",
}

export enum CardLanguage {
  English = "English",
  Japanese = "Japanese",
}

/**
 * What a stored price actually refers to.
 *
 * The client asked for reports to state whether a market value is for a raw
 * card or for one already graded (2026-07-29). The two differ by multiples for
 * the same card, so an unlabelled number is worse than no number — a collector
 * reading a raw price as a PSA 9 price will misprice a sale.
 *
 * Everything the pricing provider returns today is `raw`; `graded` exists so
 * the field does not need migrating when graded comps are wired up.
 */
export enum PriceBasis {
  raw = "raw",
  graded = "graded",
}

/** The catalogue is a local cache of the identification and pricing services, so
 *  the same card is never re-requested. */
export interface ICardInitial {
  _id?: Types.ObjectId;
  /** Stable id from the identification service — the natural key. */
  scrydexCardId: string;
  game: CardGame;
  name: string;
  language?: string;
  releaseYear?: number;
  /** The dashboard's "collection by set" grouping reads this. */
  setExpansion?: string;
  /** Printed number, e.g. "199/165". */
  cardNumber?: string;
  rarity?: string;
  officialImageUrl?: string;
  /**
   * Which Scrydex printing this row represents, e.g. "unlimitedHolofoil".
   *
   * A card id is NOT enough to identify a price. Base Set Pikachu has eleven
   * variants whose Near Mint market prices span two orders of magnitude, so
   * pricing without a variant is a coin flip. Vision reports the variant it
   * matched; it is stored here so every later refresh prices the same printing
   * and the history measures the market rather than our own bookkeeping.
   *
   * Optional: rows created before 2026-07-31, and any card whose variant Vision
   * did not report, fall back to the provider's preference order.
   */
  scrydexVariant?: string;
  latestPrice?: number;
  /** Card condition the raw price refers to, e.g. "NM". Absent for graded. */
  priceCondition?: string;
  /** Whether `latestPrice` is a raw or a graded comp. Never leave this implicit
   *  in the UI — see PriceBasis. */
  priceBasis?: PriceBasis;
  /** The grade a `graded` price refers to, e.g. "PSA 9". Absent for raw. */
  priceGradeRef?: string;
  currency: string;
  /** Drives the scheduled refresh — stale rows are re-priced first. */
  lastPricedAt?: Date;
  /**
   * When Scrydex's historical price archive was pulled for this card.
   *
   * A one-shot claim, not a timestamp anyone reads: the archive costs a credit
   * per card, so it is fetched once and never again. Set even when the archive
   * came back empty, otherwise every sweep would re-buy the same nothing.
   */
  historyBackfilledAt?: Date;
}

export type ICard = ICardInitial & Document;
