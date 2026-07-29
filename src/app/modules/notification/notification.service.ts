import httpStatus from "http-status";
import { Types } from "mongoose";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { logger } from "../../utils/logger";
import { sendEmail } from "../../utils/sendEmail";
import { emitToUser } from "../../../socket/socket";
import { User } from "../user/user.model";
import { UserRole } from "../user/user.interface";
import {
  INotification,
  INotificationSettings,
  NotifAudience,
  NotifType,
  TYPE_AUDIENCE,
} from "./notification.interface";
import { Notification, NotificationSettings } from "./notification.model";

/** Settings are created on first read rather than at signup, so accounts that
 *  predate this module still resolve to the documented defaults. */
const getOrCreateSettings = async (userId: string) => {
  const existing = await NotificationSettings.findOne({ user: userId });
  if (existing) return existing;
  return NotificationSettings.create({ user: userId });
};

/** Which email preference governs each notification type. `system` is
 *  deliberately absent — it has no user-facing toggle, so it stays in-app only
 *  rather than becoming unblockable email. */
const EMAIL_PREF_BY_TYPE: Partial<
  Record<NotifType, keyof INotificationSettings>
> = {
  [NotifType.grade_ready]: "emailGradeReady",
  [NotifType.price_alert]: "emailPriceAlert",
  [NotifType.subscription]: "emailSubscription",
  [NotifType.support]: "emailSupport",

  // Every staff alert shares one toggle, off by default. Splitting these into
  // four switches would be four settings nobody ever changes.
  [NotifType.support_ticket_new]: "emailAdminAlerts",
  [NotifType.support_ticket_reply]: "emailAdminAlerts",
  [NotifType.subscription_started]: "emailAdminAlerts",
  [NotifType.subscription_payment_failed]: "emailAdminAlerts",
};

const STAFF_ROLES = [UserRole.admin, UserRole.super_admin];

export const isStaffRole = (role?: string): boolean =>
  STAFF_ROLES.includes(role as UserRole);

const emailConfigured = (): boolean =>
  Boolean(configs.EMAIL_SENDER.smtp_host && configs.EMAIL_SENDER.smtp_user);

/**
 * Fire-and-forget email delivery. Never awaited by the caller's business flow
 * and never throws: a down SMTP server must not fail the grading, billing, or
 * support action that triggered the notification — the in-app copy is the
 * source of truth, email is best-effort.
 */
const dispatchEmail = async (
  userId: string,
  settings: INotificationSettings,
  type: NotifType,
  title: string,
  body?: string,
): Promise<void> => {
  try {
    if (!emailConfigured()) return;

    const prefKey = EMAIL_PREF_BY_TYPE[type];
    if (!prefKey || !settings[prefKey]) return;

    const user = await User.findById(userId).select("email isDeleted");
    if (!user?.email || user.isDeleted) return;

    await sendEmail({
      to: user.email,
      subject: `PixelGrade AI — ${title}`,
      templateName: "notification",
      templateData: {
        title,
        body: body ?? "",
        dashboardUrl: `${configs.frontend_url}/user-dashboard`,
      },
    });
  } catch (error) {
    logger.error("Notification email dispatch failed", { userId, type, error });
  }
};

/**
 * Internal — called by other modules (grade ready, price alert, subscription
 * renewal, support reply), never exposed as a route. A client that could mint
 * its own notifications could forge a "grade ready" or a billing message.
 *
 * Two independent channels, each behind its own preference:
 *  - in-app: when `inappEnabled` is off nothing is stored, so the unread badge
 *    stays honest rather than counting hidden rows.
 *  - email: governed per-type by the `email*` flags; sent best-effort in the
 *    background even when in-app is off, since the user opted into each
 *    channel separately.
 */
const create = async (
  userId: string | Types.ObjectId,
  type: NotifType,
  title: string,
  body?: string,
  link?: string,
) => {
  const audience = TYPE_AUDIENCE[type];

  if (audience !== NotifAudience.user) {
    // A staff type addressed to one account is always a mistake — staff alerts
    // go to every admin via createForStaff. Failing loudly here beats a support
    // alert quietly appearing in a customer's notification bell.
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `"${type}" is a staff notification — use createForStaff, not create.`,
    );
  }

  return deliver(userId, type, audience, title, body, link);
};

/**
 * Writes one notification and pushes it live.
 *
 * Shared by `create` and `createForStaff` so both channels, both preference
 * checks, and the socket push exist in exactly one place.
 */
const deliver = async (
  userId: string | Types.ObjectId,
  type: NotifType,
  audience: NotifAudience,
  title: string,
  body?: string,
  link?: string,
) => {
  const settings = await getOrCreateSettings(String(userId));

  // Deliberately not awaited — see dispatchEmail.
  void dispatchEmail(String(userId), settings, type, title, body);

  // `inappEnabled` is a user-facing preference and deliberately does NOT
  // silence staff alerts: an admin muting their personal notifications must
  // not also stop seeing that tickets are arriving.
  if (!settings.inappEnabled && audience === NotifAudience.user) return null;

  const notification = await Notification.create({
    user: userId,
    type,
    audience,
    title,
    ...(body ? { body } : {}),
    ...(link ? { link } : {}),
  });

  // Counted per audience, so the admin bell shows operational unread only and
  // the user bell shows personal unread only.
  const unreadCount = await Notification.countDocuments({
    user: userId,
    audience,
    isRead: false,
  });

  // Push live so the badge updates without a refresh. emitToUser is a no-op
  // when sockets are not up, so this is safe during seeding and in tests.
  emitToUser(String(userId), "notification:new", {
    notification,
    audience,
    unreadCount,
  });

  return notification;
};

/**
 * Fans a platform event out to every active staff account.
 *
 * One row per admin rather than one shared row, because read state is
 * per-person: a shared notification would be marked read for the whole team by
 * whoever opened it first.
 *
 * Never throws into the caller's flow. A support ticket must still be created
 * if the alert fails to reach one of three admins — the ticket is the record,
 * the notification is a convenience.
 */
const createForStaff = async (
  type: NotifType,
  title: string,
  body?: string,
  link?: string,
) => {
  const audience = TYPE_AUDIENCE[type];

  if (audience !== NotifAudience.admin) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `"${type}" is a user notification — use create, not createForStaff.`,
    );
  }

  try {
    const staff = await User.find({
      role: { $in: STAFF_ROLES },
      isDeleted: false,
      status: "active",
    }).select("_id");

    if (staff.length === 0) {
      logger.warn("Staff notification had no recipients", { type, title });
      return [];
    }

    const results = await Promise.allSettled(
      staff.map((admin) =>
        deliver(admin._id as Types.ObjectId, type, audience, title, body, link),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error("Staff notification failed for one admin", {
          adminId: String(staff[index]._id),
          type,
          error: result.reason,
        });
      }
    });

    return results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
  } catch (error) {
    logger.error("Staff notification fan-out failed", { type, error });
    return [];
  }
};

/**
 * Admin announcement to every active customer.
 *
 * The one place a notification originates from a request rather than from a
 * platform event, so it is admin-guarded at the route and typed `system`,
 * which carries no email preference and therefore cannot be used to bypass a
 * user's email opt-outs.
 *
 * ⚠️ Writes one row per user. Fine at current scale; past roughly ten thousand
 * accounts this wants a queue rather than a request.
 */
const broadcast = async (title: string, body?: string, link?: string) => {
  const recipients = await User.find({
    role: UserRole.user,
    isDeleted: false,
    status: "active",
  }).select("_id");

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      deliver(
        recipient._id as Types.ObjectId,
        NotifType.system,
        NotifAudience.user,
        title,
        body,
        link,
      ),
    ),
  );

  const delivered = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.length - delivered;

  if (failed > 0) {
    logger.error("Broadcast partially failed", { delivered, failed });
  }

  return { recipients: recipients.length, delivered, failed };
};

/**
 * Resolves which audience a caller is allowed to read.
 *
 * Only staff may ask for `admin`. A regular user requesting it would get an
 * empty list anyway — no staff-audience row is ever written to a customer —
 * but refusing explicitly keeps the rule in one readable place instead of
 * relying on that emergent property staying true.
 *
 * Defaults to `user`, so an un-parameterised call can never widen scope.
 */
const resolveAudience = (
  role: string | undefined,
  requested?: string,
): NotifAudience => {
  if (requested === NotifAudience.admin) {
    if (!isStaffRole(role)) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Only staff can read admin notifications.",
      );
    }
    return NotifAudience.admin;
  }
  return NotifAudience.user;
};

const getMyNotifications = async (
  userId: string,
  role: string | undefined,
  query: Record<string, string>,
) => {
  const audience = resolveAudience(role, query.audience);

  // `audience` is stripped from the passthrough filter — it is resolved above
  // against the caller's role, and letting QueryBuilder apply the raw param
  // would hand the client back control of the thing we just authorised.
  const filters = { ...query };
  delete filters.audience;

  const queryBuilder = new QueryBuilder<INotification>(
    Notification.find({ user: userId, audience }),
    filters,
  );

  const notifications = await queryBuilder
    .filter()
    .sort()
    .paginate()
    .build();
  const meta = await queryBuilder.getMeta();

  return { data: notifications, meta };
};

const getUnreadCount = async (
  userId: string,
  role: string | undefined,
  requestedAudience?: string,
) => {
  const audience = resolveAudience(role, requestedAudience);

  const count = await Notification.countDocuments({
    user: userId,
    audience,
    isRead: false,
  });
  return { unreadCount: count, audience };
};

/** Scoped to the owner in the query itself, so one user cannot mark another
 *  user's notification as read by guessing an id. */
const markAsRead = async (userId: string, notificationId: string) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { isRead: true },
    { returnDocument: "after" },
  );
  if (!notification) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  // Recount within the notification's OWN audience — marking a staff alert read
  // must not decrement the personal badge, and vice versa.
  const unreadCount = await Notification.countDocuments({
    user: userId,
    audience: notification.audience,
    isRead: false,
  });

  emitToUser(userId, "notification:read", {
    notificationId,
    audience: notification.audience,
    unreadCount,
  });

  return notification;
};

/** Scoped to one audience, so "mark all read" in the admin bell does not also
 *  clear the reader's personal notifications. */
const markAllAsRead = async (
  userId: string,
  role: string | undefined,
  requestedAudience?: string,
) => {
  const audience = resolveAudience(role, requestedAudience);

  await Notification.updateMany(
    { user: userId, audience, isRead: false },
    { isRead: true },
  );

  emitToUser(userId, "notification:read_all", { audience, unreadCount: 0 });
  return { unreadCount: 0, audience };
};

const remove = async (userId: string, notificationId: string) => {
  const deleted = await Notification.findOneAndDelete({
    _id: notificationId,
    user: userId,
  });
  if (!deleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }
  return deleted;
};

const getSettings = async (userId: string) => {
  return getOrCreateSettings(userId);
};

const updateSettings = async (
  userId: string,
  payload: Partial<INotificationSettings>,
) => {
  await getOrCreateSettings(userId);
  return NotificationSettings.findOneAndUpdate({ user: userId }, payload, {
    returnDocument: "after",
    runValidators: true,
  });
};

export const NotificationServices = {
  create,
  createForStaff,
  broadcast,
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  remove,
  getSettings,
  updateSettings,
};
