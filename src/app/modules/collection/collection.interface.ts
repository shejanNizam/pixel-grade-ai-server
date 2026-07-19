import { Document, Types } from "mongoose";

/** A collection entry is either a scanned card (backed by a grading report) or a
 *  manual entry the user typed in. `report` is nullable precisely so the manual
 *  path does not need a fake grade. */
export interface ICollectionItemInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  card: Types.ObjectId;
  /** Null when added manually — no AI grade exists. */
  report?: Types.ObjectId;
  /** Set when added manually, since there is no analysis image to fall back on. */
  manualImageUrl?: string;
  /** A third-party grade the card already carries, e.g. "PSA 9 MINT". Kept
   *  distinct from our AI grade so the two are never conflated. */
  externalGrade?: string;
  quantity: number;
  favorite: boolean;
  /** Denormalised from the card catalogue so collection listing and total-value
   *  maths do not need a join per row. Refreshed by the pricing job. */
  currentPrice?: number;
  change24h?: number;
  change7d?: number;
  change30d?: number;
  /** Schema-managed (`timestamps.createdAt` is aliased to this). Declared so
   *  "what did this user hold in month N" can be answered without a cast. */
  addedAt?: Date;
}

export type ICollectionItem = ICollectionItemInitial & Document;
