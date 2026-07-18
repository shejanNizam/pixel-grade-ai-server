import { model, Schema } from "mongoose";
import { IPriceHistory, PriceSource } from "./price.interface";

export const priceHistorySchema = new Schema<IPriceHistory>(
  {
    card: { type: Schema.Types.ObjectId, ref: "Card", required: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    source: {
      type: String,
      enum: Object.values(PriceSource),
      required: true,
    },
    capturedAt: { type: Date, required: true, default: Date.now },
  },
  {
    // capturedAt is the real timestamp here — it is set by the refresh job and
    // may differ from insert time on a backfill, so a createdAt would mislead.
    timestamps: false,
    versionKey: false,
  },
);

// Every read is "this card, over this window, in order".
priceHistorySchema.index({ card: 1, capturedAt: -1 });

export const PriceHistory = model<IPriceHistory>(
  "PriceHistory",
  priceHistorySchema,
);
