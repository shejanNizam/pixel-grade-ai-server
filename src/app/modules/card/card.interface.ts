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
  latestPrice?: number;
  currency: string;
  /** Drives the scheduled refresh — stale rows are re-priced first. */
  lastPricedAt?: Date;
}

export type ICard = ICardInitial & Document;
