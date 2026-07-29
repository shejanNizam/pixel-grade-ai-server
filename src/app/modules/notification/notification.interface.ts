import { Document, Types } from "mongoose";

/**
 * Who a notification is speaking to.
 *
 * NOT the same thing as who owns the row. Every notification is still stored
 * per-recipient — that is what gives each person their own read state — but an
 * admin account legitimately receives both kinds: personal ones about their own
 * scans and subscription, and operational ones about the platform. `audience`
 * is what lets the two dashboards show the right subset instead of mixing
 * "your grade is ready" into the staff queue.
 */
export enum NotifAudience {
  /** About the recipient's own activity. Shown in the user dashboard. */
  user = "user",
  /** About platform operations. Shown in the admin dashboard, staff only. */
  admin = "admin",
}

export enum NotifType {
  // ---- user-facing ----
  grade_ready = "grade_ready",
  price_alert = "price_alert",
  subscription = "subscription",
  support = "support",
  /** Announcements broadcast by an admin. */
  system = "system",

  // ---- staff-facing ----
  /** A user opened a new support ticket. */
  support_ticket_new = "support_ticket_new",
  /** A user replied on an existing ticket, reopening it. */
  support_ticket_reply = "support_ticket_reply",
  /** A paid subscription activated. */
  subscription_started = "subscription_started",
  /** A subscription payment failed — the user may be about to churn. */
  subscription_payment_failed = "subscription_payment_failed",
}

/**
 * Which audience each type belongs to.
 *
 * Declared once here so a type cannot be delivered to the wrong dashboard by
 * accident: `create` and `createForStaff` both assert against this, which turns
 * "staff alert leaked into a customer's bell" from a silent data problem into a
 * loud failure at the call site.
 */
export const TYPE_AUDIENCE: Record<NotifType, NotifAudience> = {
  [NotifType.grade_ready]: NotifAudience.user,
  [NotifType.price_alert]: NotifAudience.user,
  [NotifType.subscription]: NotifAudience.user,
  [NotifType.support]: NotifAudience.user,
  [NotifType.system]: NotifAudience.user,

  [NotifType.support_ticket_new]: NotifAudience.admin,
  [NotifType.support_ticket_reply]: NotifAudience.admin,
  [NotifType.subscription_started]: NotifAudience.admin,
  [NotifType.subscription_payment_failed]: NotifAudience.admin,
};

export interface INotificationInitial {
  _id?: Types.ObjectId;
  /** The recipient. Rows are per-person so read state is per-person — a shared
   *  staff notification would be marked read for every admin by whoever opened
   *  it first. */
  user: Types.ObjectId;
  type: NotifType;
  /** Derived from `type` via TYPE_AUDIENCE; stored so it can be indexed and
   *  filtered without a lookup. */
  audience: NotifAudience;
  title: string;
  body?: string;
  isRead: boolean;
  /** Where clicking the notification should take the recipient, as a path.
   *  A staff alert about a ticket is useless if it does not open the ticket. */
  link?: string;
}

export type INotification = INotificationInitial & Document;

/** Per-user delivery preferences. One row per user, created alongside the
 *  account so the defaults are real stored values rather than implied ones. */
export interface INotificationSettingsInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  inappEnabled: boolean;
  emailGradeReady: boolean;
  emailPriceAlert: boolean;
  emailSubscription: boolean;
  emailSupport: boolean;
  /** Staff only, and OFF by default: an admin who also uses the product should
   *  not start receiving an email for every ticket the moment they are
   *  promoted. In-app staff alerts are always on for staff. */
  emailAdminAlerts: boolean;
}

export type INotificationSettings = INotificationSettingsInitial & Document;
