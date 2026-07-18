import { model, Schema } from "mongoose";
import {
  BillingInterval,
  ISubscription,
  SubStatus,
} from "./subscription.interface";

export const subscriptionSchema = new Schema<ISubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    plan: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    interval: {
      type: String,
      enum: Object.values(BillingInterval),
      default: BillingInterval.monthly,
    },
    status: {
      type: String,
      enum: Object.values(SubStatus),
      default: SubStatus.active,
    },
    currentPeriodEnd: { type: Date },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    stripeSubscriptionId: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

subscriptionSchema.index({ user: 1, status: 1 });
// Sparse: rows exist before Stripe assigns an id, and for the Free tier which
// never reaches Stripe at all. A plain unique index would collide on null.
subscriptionSchema.index(
  { stripeSubscriptionId: 1 },
  { unique: true, sparse: true },
);

export const Subscription = model<ISubscription>(
  "Subscription",
  subscriptionSchema,
);
