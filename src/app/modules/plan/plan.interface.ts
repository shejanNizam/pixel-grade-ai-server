import { Document, Types } from "mongoose";

/** The four tiers are fixed. Admin edits them; nobody creates, deletes, or
 *  renames one, so the name doubles as a stable identifier. */
export enum PlanName {
  Free = "Free",
  Collector = "Collector",
  Pro = "Pro",
  Enterprise = "Enterprise",
}

/** When a plan's credit allowance is refilled. Free is topped up daily; every
 *  paid tier is refilled monthly — including yearly subscribers, who get their
 *  monthly allowance twelve times rather than the whole year up front. */
export enum CreditInterval {
  daily = "daily",
  monthly = "monthly",
}

export interface IPlanInitial {
  _id?: Types.ObjectId;
  name: PlanName;
  tagline?: string;
  /** Whole dollars per month at monthly list price. */
  priceMonthly: number;
  /** Effective per-month price when billed yearly; charged as ×12 up front. */
  priceYearly: number;
  /** Credits granted each interval. `null` means unlimited (Enterprise). */
  creditAmount: number | null;
  creditInterval: CreditInterval;
  /** Advanced multi-image scan. Also the gate on Pixel Verified — a plan
   *  without PixelScope can never earn the badge. */
  pixelscope: boolean;
  priceTracking: boolean;
  /** Free reports are watermarked PDFs; paid tiers get clean ones. */
  watermarkReports: boolean;
  /** Display bullets for the pricing table. */
  features: string[];
  isActive: boolean;
  stripePriceIdMonth?: string;
  stripePriceIdYear?: string;
}

export type IPlan = IPlanInitial & Document;
