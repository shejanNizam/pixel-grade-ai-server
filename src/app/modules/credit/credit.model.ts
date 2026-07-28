import { model, Schema } from "mongoose";
import {
  CreditReason,
  ICreditLedger,
  ICreditWallet,
} from "./credit.interface";

export const creditWalletSchema = new Schema<ICreditWallet>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: { type: Number, default: 0, min: 0 },
    isUnlimited: { type: Boolean, default: false },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    lastDailyGrantAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const CreditWallet = model<ICreditWallet>(
  "CreditWallet",
  creditWalletSchema,
);

export const creditLedgerSchema = new Schema<ICreditLedger>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    reason: {
      type: String,
      enum: Object.values(CreditReason),
      required: true,
    },
    analysis: { type: Schema.Types.ObjectId, ref: "CardAnalysis" },
    balanceAfter: { type: Number, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Retained indefinitely for audit and admin analytics — never pruned.
creditLedgerSchema.index({ user: 1, createdAt: -1 });

/**
 * One debit and at most one refund per scan, enforced by the database.
 *
 * The service checks before refunding, but a check-then-write cannot survive
 * two concurrent cancels (a user closing the dialog at the same moment the
 * sweeper picks the scan up). This index makes the second write fail outright,
 * so a scan can never be refunded twice and mint credits.
 */
creditLedgerSchema.index(
  { analysis: 1, reason: 1 },
  {
    unique: true,
    partialFilterExpression: { analysis: { $exists: true } },
  },
);

export const CreditLedger = model<ICreditLedger>(
  "CreditLedger",
  creditLedgerSchema,
);
