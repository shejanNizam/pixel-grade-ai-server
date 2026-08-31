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
    japaneseName: { type: String },
    language: { type: String },
    releaseYear: { type: Number },
    setExpansion: { type: String },
    cardNumber: { type: String },
    rarity: { type: String },
    // Palette cue for slab artwork — see the interface.
    types: { type: [String], default: undefined },
    officialImageUrl: { type: String },
    // Which printing this row is. See the interface — a card id alone does not
    // identify a price, and refreshing a different variant each pass would put
    // our own bookkeeping into the price history as if it were market movement.
    scrydexVariant: { type: String },
    latestPrice: { type: Number },
    priceCondition: { type: String },
    // Defaulted rather than optional: an unlabelled price is the ambiguity the
    // client reported, and everything the pricing provider returns today is a
    // raw comp. A graded price must set this explicitly.
    priceBasis: {
      type: String,
      enum: Object.values(PriceBasis),
      default: PriceBasis.raw,
    },
    priceGradeRef: { type: String },
    // The PSA ladder for this printing. `_id: false` because these are values,
    // not documents — nothing ever references a single rung.
    gradedPrices: {
      type: [
        {
          _id: false,
          grade: { type: String, required: true },
          price: { type: Number, required: true, min: 0 },
        },
      ],
      default: undefined,
    },
    gradedCompany: { type: String },
    currency: { type: String, default: "USD" },
    lastPricedAt: { type: Date },
    // One-shot claim for the historical archive pull — see the interface.
    historyBackfilledAt: { type: Date },
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
