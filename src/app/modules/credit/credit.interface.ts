import { Document, Types } from "mongoose";

/** Why a credit entry exists. Every movement in or out of a wallet writes one
 *  ledger row with one of these — the ledger is the audit trail, so there is no
 *  such thing as an unexplained balance change. */
export enum CreditReason {
  grant_daily = "grant_daily",
  grant_monthly = "grant_monthly",
  /** Spend. Always -CREDITS_PER_SCAN, and always carries an analysisId. */
  scan = "scan",
  refund = "refund",
  admin_adjust = "admin_adjust",
}

export interface ICreditWalletInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  balance: number;
  /** Enterprise. When true the balance is ignored and no debit is recorded. */
  isUnlimited: boolean;
  periodStart?: Date;
  periodEnd?: Date;
  /** Guards the Free daily reset so a restarted cron cannot double-grant. */
  lastDailyGrantAt?: Date;
}

export type ICreditWallet = ICreditWalletInitial & Document;

export interface ICreditLedgerInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  /** Positive for a grant, negative for a spend (e.g. -10 for one scan). */
  amount: number;
  reason: CreditReason;
  /** Set when reason is `scan`, so a spend can always be traced to its scan. */
  analysis?: Types.ObjectId;
  /** Balance immediately after this entry — lets the ledger be replayed and
   *  reconciled against the wallet without recomputing from zero. */
  balanceAfter: number;
  /** Context the reason alone does not carry, e.g. which admin made an
   *  adjustment. Kept loose because each reason needs different detail. */
  meta?: Record<string, unknown>;
}

export type ICreditLedger = ICreditLedgerInitial & Document;
