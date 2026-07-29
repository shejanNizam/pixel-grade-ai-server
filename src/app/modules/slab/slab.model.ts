import { model, Schema } from "mongoose";
import { SLAB_DEFAULTS, SLAB_STYLES } from "../../constants";
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

export const slabOrderSchema = new Schema<ISlabOrder>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    slabLabel: {
      type: Schema.Types.ObjectId,
      ref: "SlabLabel",
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(SlabOrderStatus),
      default: SlabOrderStatus.pending,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    stripeRef: { type: String },
    transaction: { type: Schema.Types.ObjectId, ref: "Transaction" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

slabOrderSchema.index({ user: 1, createdAt: -1 });
slabOrderSchema.index({ status: 1 });

export const SlabOrder = model<ISlabOrder>("SlabOrder", slabOrderSchema);
