import { Document, Types } from "mongoose";

/** Money records cover both recurring subscriptions and one-off slab orders,
 *  so admin earnings can report on either without a second collection. */
export enum TxnType {
  subscription = "subscription",
  slab_order = "slab_order",
}

export enum TxnStatus {
  pending = "pending",
  succeeded = "succeeded",
  failed = "failed",
  refunded = "refunded",
}

export interface ITransactionInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  type: TxnType;
  /** Set when type is `subscription`. */
  subscription?: Types.ObjectId;
  plan?: Types.ObjectId;
  /** Set when type is `slab_order`. */
  slabOrder?: Types.ObjectId;
  invoiceNumber?: string;
  amount: number;
  currency: string;
  status: TxnStatus;
  stripeRef?: string;
}

export type ITransaction = ITransactionInitial & Document;
