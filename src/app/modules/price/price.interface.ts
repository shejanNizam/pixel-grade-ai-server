import { Document, Types } from "mongoose";

export enum PriceSource {
  tcgplayer = "tcgplayer",
  pricecharting = "pricecharting",
  cardmarket = "cardmarket",
  scrydex = "scrydex",
}

/** Retained permanently. Powers the sparklines and the 7-day / 30-day / 1-year
 *  graphs, so no point is ever pruned — the 1-year window needs a year of them. */
export interface IPriceHistoryInitial {
  _id?: Types.ObjectId;
  card: Types.ObjectId;
  price: number;
  currency: string;
  source: PriceSource;
  capturedAt: Date;
}

export type IPriceHistory = IPriceHistoryInitial & Document;
