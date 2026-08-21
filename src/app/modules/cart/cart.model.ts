import { Schema, model } from "mongoose";
import { ICart, ICartItem } from "./cart.interface";

const cartItemSchema = new Schema<ICartItem>(
  {
    slab: { type: Schema.Types.ObjectId, ref: "SlabLabel", required: true },
    cardName: { type: String, required: true },
    grade: { type: Number, required: true },
    gradeLabel: { type: String, required: true },
    compositeUrl: { type: String, required: true },
    price: { type: Number, required: true, default: 24.99 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const cartSchema = new Schema<ICart>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    items: [cartItemSchema],
  },
  { timestamps: true },
);

export const Cart = model<ICart>("Cart", cartSchema);
