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
//
// ⚠️ Deliberately NOT unique, even though Scrydex's historical archive and our
// own daily sweep overlap and could double-write a day. Adding `unique: true`
// here does not work: MongoDB refuses to change an existing index's options, so
// on any database that already has this index Mongoose's createIndex fails with
// an IndexOptionsConflict, logs it, and carries on — leaving the index
// non-unique while the code believes it is protected. That is worse than no
// constraint at all.
//
// De-duplication is therefore explicit, in `PriceServices.backfillHistory`,
// where it is visible and testable. If a unique constraint is ever genuinely
// wanted it needs a real migration that drops this index first.
priceHistorySchema.index({ card: 1, capturedAt: -1 });

export const PriceHistory = model<IPriceHistory>(
  "PriceHistory",
  priceHistorySchema,
);
