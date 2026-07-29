import { model, Schema } from "mongoose";
import { CardGame, ICard, PriceBasis } from "./card.interface";

export const cardSchema = new Schema<ICard>(
  {
    scrydexCardId: { type: String, required: true, unique: true },
    game: {
      type: String,
      enum: Object.values(CardGame),
      default: CardGame.pokemon,
    },
    name: { type: String, required: true },
    language: { type: String },
    releaseYear: { type: Number },
    setExpansion: { type: String },
    cardNumber: { type: String },
    rarity: { type: String },
    officialImageUrl: { type: String },
    latestPrice: { type: Number },
    // Defaulted rather than optional: an unlabelled price is the ambiguity the
    // client reported, and everything the pricing provider returns today is a
    // raw comp. A graded price must set this explicitly.
    priceBasis: {
      type: String,
      enum: Object.values(PriceBasis),
      default: PriceBasis.raw,
    },
    priceGradeRef: { type: String },
    currency: { type: String, default: "USD" },
    lastPricedAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

cardSchema.index({ name: 1 });
cardSchema.index({ setExpansion: 1 });
// The price-refresh job sweeps oldest-first, so it needs this ordering.
cardSchema.index({ lastPricedAt: 1 });

export const Card = model<ICard>("Card", cardSchema);
