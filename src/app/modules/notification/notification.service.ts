import httpStatus from "http-status";
import { Types } from "mongoose";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { logger } from "../../utils/logger";
import { sendEmail } from "../../utils/sendEmail";
import { emitToUser } from "../../../socket/socket";
import { User } from "../user/user.model";
import {
  INotification,
  INotificationSettings,
  NotifType,
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
};

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
) => {
  const settings = await getOrCreateSettings(String(userId));

  // Deliberately not awaited — see dispatchEmail.
  void dispatchEmail(String(userId), settings, type, title, body);

  if (!settings.inappEnabled) return null;

  const notification = await Notification.create({
    user: userId,
    type,
    title,
    ...(body ? { body } : {}),
  });

  const unreadCount = await Notification.countDocuments({
    user: userId,
    isRead: false,
  });

  // Push live so the badge updates without a refresh. emitToUser is a no-op
  // when sockets are not up, so this is safe during seeding and in tests.
  emitToUser(String(userId), "notification:new", { notification, unreadCount });

  return notification;
};

const getMyNotifications = async (
  userId: string,
  query: Record<string, string>,
) => {
  const queryBuilder = new QueryBuilder<INotification>(
    Notification.find({ user: userId }),
    query,
  );

  const notifications = await queryBuilder
    .filter()
    .sort()
    .paginate()
    .build();
  const meta = await queryBuilder.getMeta();

  return { data: notifications, meta };
};

const getUnreadCount = async (userId: string) => {
  const count = await Notification.countDocuments({
    user: userId,
    isRead: false,
  });
  return { unreadCount: count };
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

  const { unreadCount } = await getUnreadCount(userId);
  emitToUser(userId, "notification:read", { notificationId, unreadCount });

  return notification;
};

const markAllAsRead = async (userId: string) => {
  await Notification.updateMany(
    { user: userId, isRead: false },
    { isRead: true },
  );
  emitToUser(userId, "notification:read_all", { unreadCount: 0 });
  return { unreadCount: 0 };
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
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  remove,
  getSettings,
  updateSettings,
};
