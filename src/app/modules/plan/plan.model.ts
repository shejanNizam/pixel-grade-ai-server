import { model, Schema } from "mongoose";
import { CreditInterval, IPlan, PlanName } from "./plan.interface";

export const planSchema = new Schema<IPlan>(
  {
    name: {
      type: String,
      enum: Object.values(PlanName),
      required: true,
      unique: true,
    },
    tagline: { type: String },
    priceMonthly: { type: Number, required: true, min: 0 },
    priceYearly: { type: Number, required: true, min: 0 },
    // `null` is meaningful here — it means unlimited, not missing. `default:
    // undefined` would let Mongoose drop the key, so the default is explicit.
    creditAmount: { type: Number, default: null, min: 0 },
    creditInterval: {
      type: String,
      enum: Object.values(CreditInterval),
      default: CreditInterval.monthly,
    },
    pixelscope: { type: Boolean, default: false },
    priceTracking: { type: Boolean, default: false },
    watermarkReports: { type: Boolean, default: true },
    features: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    stripePriceIdMonth: { type: String },
    stripePriceIdYear: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const Plan = model<IPlan>("Plan", planSchema);
