import { model, Schema } from "mongoose";
import { ICollectionItem } from "./collection.interface";

export const collectionItemSchema = new Schema<ICollectionItem>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    card: { type: Schema.Types.ObjectId, ref: "Card", required: true },
    report: { type: Schema.Types.ObjectId, ref: "GradingReport" },
    manualImageUrl: { type: String },
    externalGrade: { type: String },
    quantity: { type: Number, default: 1, min: 1 },
    favorite: { type: Boolean, default: false },
    currentPrice: { type: Number },
    change24h: { type: Number },
    change7d: { type: Number },
    change30d: { type: Number },
  },
  {
    timestamps: { createdAt: "addedAt", updatedAt: true },
    versionKey: false,
  },
);

collectionItemSchema.index({ user: 1, addedAt: -1 });
// Not unique — the same card can appear twice with different grades (one PSA 9
// slabbed copy, one raw), which is why quantity exists per entry rather than
// being forced into a single row.
collectionItemSchema.index({ user: 1, card: 1 });
collectionItemSchema.index({ user: 1, favorite: 1 });

export const CollectionItem = model<ICollectionItem>(
  "CollectionItem",
  collectionItemSchema,
);
