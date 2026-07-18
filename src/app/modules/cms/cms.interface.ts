import { Document, Types } from "mongoose";

/** Exactly three pages, each public. The slug is the identity — pages are
 *  seeded once and thereafter only edited. */
export enum CmsSlug {
  about = "about",
  terms = "terms",
  privacy = "privacy",
}

export interface ICmsPageInitial {
  _id?: Types.ObjectId;
  slug: CmsSlug;
  /** Produced by the admin rich-text editor. Sanitise on write — this is
   *  rendered as HTML on public pages. */
  htmlContent: string;
  /** Who last edited, for the admin audit trail. */
  updatedBy?: Types.ObjectId;
}

export type ICmsPage = ICmsPageInitial & Document;
