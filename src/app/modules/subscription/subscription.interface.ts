import { Document, Types } from "mongoose";

/** Yearly is charged up front at the effective monthly rate × 12. It does not
 *  change the credit cadence — a yearly subscriber still refills monthly. */
export enum BillingInterval {
  monthly = "monthly",
  yearly = "yearly",
}

export enum SubStatus {
  active = "active",
  canceled = "canceled",
  past_due = "past_due",
  expired = "expired",
}

export interface ISubscriptionInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  plan: Types.ObjectId;
  interval: BillingInterval;
  status: SubStatus;
  /** Shown to the user as the next renewal date. */
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  stripeSubscriptionId?: string;
}

export type ISubscription = ISubscriptionInitial & Document;
