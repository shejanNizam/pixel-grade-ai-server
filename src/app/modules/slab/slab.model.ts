import { model, Schema } from "mongoose";
import {
  SLAB_CARD_RENDER_MODES,
  SLAB_DEFAULTS,
  SLAB_STYLES,
} from "../../constants";
import { ISlabLabel, ISlabOrder, SlabOrderStatus } from "./slab.interface";

export const slabLabelSchema = new Schema<ISlabLabel>(
  {
    report: {
      type: Schema.Types.ObjectId,
      ref: "GradingReport",
      required: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    styleId: {
      type: String,
      enum: SLAB_STYLES,
      default: SLAB_STYLES[0],
    },
    // The four EXT. ART options. Empty on labels created before 2026-07-30 —
    // those still render from `backgroundUrl` alone.
    variants: {
      type: [
        new Schema(
          {
            index: { type: Number, required: true, min: 1 },
            artworkUrl: { type: String, required: true },
            compositeUrl: { type: String },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    selectedVariant: { type: Number, min: 1 },
    // Frozen once resolved — see ISlabLabelInitial.cardImageUrl.
    cardImageUrl: { type: String },
    cardImageSource: { type: String, enum: SLAB_CARD_RENDER_MODES },
    backgroundUrl: { type: String },
    compositeUrl: { type: String },
    exportPngUrl: { type: String },
    exportPdfUrl: { type: String },
    widthMm: { type: Number, default: SLAB_DEFAULTS.widthMm },
    heightMm: { type: Number, default: SLAB_DEFAULTS.heightMm },
    openingWMm: { type: Number, default: SLAB_DEFAULTS.openingWidthMm },
    openingHMm: { type: Number, default: SLAB_DEFAULTS.openingHeightMm },
    labelWMm: { type: Number, default: SLAB_DEFAULTS.labelWidthMm },
    labelHMm: { type: Number, default: SLAB_DEFAULTS.labelHeightMm },
    bleedMm: { type: Number, default: SLAB_DEFAULTS.bleedMm },
    safeMm: { type: Number, default: SLAB_DEFAULTS.safeMm },
    version: { type: Number, default: 1, min: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// A report accumulates label versions; the latest is read most often.
slabLabelSchema.index({ report: 1, version: -1 });
slabLabelSchema.index({ user: 1, createdAt: -1 });

export const SlabLabel = model<ISlabLabel>("SlabLabel", slabLabelSchema);
export { SlabOrder } from "../slabOrder/slabOrder.model";
