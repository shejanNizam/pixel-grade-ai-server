import { Document, Types } from "mongoose";
import { SlabCardRenderMode, SlabStyle } from "../../constants";

/** Digital release or physical shipment is still unconfirmed by the client, so
 *  `fulfilled` deliberately means "delivered, however that ends up working" and
 *  there are no shipping fields yet. See docs/OPEN-QUESTIONS.md. */
export enum SlabOrderStatus {
  pending = "pending",
  paid = "paid",
  fulfilled = "fulfilled",
  canceled = "canceled",
}

/**
 * One EXT. ART option.
 *
 * Both URLs are kept because they answer different questions. `artworkUrl` is
 * the bare generated environment — that is what the thumbnail shows, and the
 * client was explicit that thumbnails must not contain the card. `compositeUrl`
 * is the full server render of that option, so selecting one swaps the large
 * preview instantly instead of waiting on a re-composite.
 */
export interface ISlabVariant {
  /** 1-based, matching the "EXT. ART n" label the user sees. */
  index: number;
  /** The generated environment alone. Never has the card composited into it. */
  artworkUrl: string;
  /** Full slab render using this artwork — what the preview and export show. */
  compositeUrl?: string;
}

/** Geometry is stored per label rather than read from constants at render time.
 *  The printer's final spec sheet may move these numbers, and labels already
 *  exported must keep rendering at the dimensions they were sold at. */
export interface ISlabLabelInitial {
  _id?: Types.ObjectId;
  report: Types.ObjectId;
  user: Types.ObjectId;
  /** LEGACY fixed theme. Replaced by card-derived variants on 2026-07-30;
   *  retained so labels sold before then still re-render as sold. */
  styleId: SlabStyle;
  /** The four generated options the user chooses between. */
  variants: ISlabVariant[];
  /** Which variant is selected, as a 1-based `ISlabVariant.index`. */
  selectedVariant?: number;
  /** The selected option's artwork. Mirrors `variants[selected].artworkUrl`
   *  and stays the single source the renderer reads, so legacy labels with no
   *  variants keep working unchanged. */
  backgroundUrl?: string;
  /**
   * What actually went in the card window, resolved once and then frozen.
   *
   * Cached rather than re-resolved per render for two reasons: under
   * `generated` mode it is a billed image that must not be re-bought on every
   * background regeneration, and a slab must not silently change the card it
   * depicts after the user has approved it.
   */
  cardImageUrl?: string;
  /** Which SLAB_CARD_RENDER_MODES branch produced `cardImageUrl`. Recorded so
   *  a label can be audited later — "is this a photo of the graded card, or a
   *  rendering?" is not a question anyone should have to guess at. */
  cardImageSource?: SlabCardRenderMode;
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
  /** The grading label band above the window. Stored per label like every
   *  other dimension: labels already exported must keep the layout they were
   *  sold at even after the printer's spec moves again. */
  labelWMm: number;
  labelHMm: number;
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
