import { model, Schema } from "mongoose";
import { ITransaction, TxnStatus, TxnType } from "./transaction.interface";

export const transactionSchema = new Schema<ITransaction>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: Object.values(TxnType), required: true },
    subscription: { type: Schema.Types.ObjectId, ref: "Subscription" },
    plan: { type: Schema.Types.ObjectId, ref: "Plan" },
    slabOrder: { type: Schema.Types.ObjectId, ref: "SlabOrder" },
    invoiceNumber: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    status: {
      type: String,
      enum: Object.values(TxnStatus),
      default: TxnStatus.pending,
    },
    stripeRef: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Retained indefinitely for audit — never pruned.
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1, status: 1 });

export const Transaction = model<ITransaction>("Transaction", transactionSchema);
