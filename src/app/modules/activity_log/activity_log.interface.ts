import { Document, Types } from "mongoose";

/** Known actions. Kept as an enum so a typo cannot silently create a new
 *  category that admin analytics then never counts. */
export enum ActivityAction {
  login = "login",
  login_failed = "login_failed",
  register = "register",
  upload = "upload",
  identify = "identify",
  confirm_match = "confirm_match",
  grade = "grade",
  slab_export = "slab_export",
  slab_order = "slab_order",
  delete = "delete",
  admin_action = "admin_action",
  price_refresh = "price_refresh",
  credit_grant = "credit_grant",
}

/** Retained a minimum of one year. Covers auth attempts (including failures,
 *  which have no user), user actions, admin actions, and scheduled jobs. */
export interface IActivityLogInitial {
  _id?: Types.ObjectId;
  /** Null for anonymous requests and failed logins where no account matched. */
  user?: Types.ObjectId;
  action: ActivityAction;
  meta?: Record<string, unknown>;
  ipAddress?: string;
}

export type IActivityLog = IActivityLogInitial & Document;
