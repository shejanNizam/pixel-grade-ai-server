import { Document, Types } from "mongoose";
import { SlabStyle } from "../../constants";

/** Digital release or physical shipment is still unconfirmed by the client, so
 *  `fulfilled` deliberately means "delivered, however that ends up working" and
 *  there are no shipping fields yet. See docs/OPEN-QUESTIONS.md. */
export enum SlabOrderStatus {
  pending = "pending",
  paid = "paid",
  fulfilled = "fulfilled",
  canceled = "canceled",
}

/** Geometry is stored per label rather than read from constants at render time.
 *  The printer's final spec sheet may move these numbers, and labels already
 *  exported must keep rendering at the dimensions they were sold at. */
export interface ISlabLabelInitial {
  _id?: Types.ObjectId;
  report: Types.ObjectId;
  user: Types.ObjectId;
  styleId: SlabStyle;
  /** The AI-generated layer — the only thing "regenerate" replaces. */
  backgroundUrl?: string;
  /** Card image + label text composited server-side, so a client can never
   *  break the template or shift the card opening. */
  compositeUrl?: string;
  exportPngUrl?: string;
  exportPdfUrl?: string;
  /** Overall trim, in millimetres. */
  widthMm: number;
  heightMm: number;
  /** The card window. Fixed — never shifts relative to the trim. */
  openingWMm: number;
  openingHMm: number;
  bleedMm: number;
  safeMm: number;
  /** Increments on each regenerate. Labels are kept, not overwritten. */
  version: number;
}

export type ISlabLabel = ISlabLabelInitial & Document;

export interface ISlabOrderInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  slabLabel: Types.ObjectId;
  status: SlabOrderStatus;
  amount: number;
  currency: string;
  stripeRef?: string;
  /** The money record. Orders are charged per-order, not via subscription. */
  transaction?: Types.ObjectId;
}

export type ISlabOrder = ISlabOrderInitial & Document;
