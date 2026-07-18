import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { emitToUser } from "../../../socket/socket";
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

/**
 * Internal — called by other modules (grade ready, price alert, subscription
 * renewal, support reply), never exposed as a route. A client that could mint
 * its own notifications could forge a "grade ready" or a billing message.
 *
 * Respects the user's in-app preference: when disabled, nothing is stored, so
 * the unread badge stays honest rather than counting hidden rows.
 */
const create = async (
  userId: string | Types.ObjectId,
  type: NotifType,
  title: string,
  body?: string,
) => {
  const settings = await getOrCreateSettings(String(userId));
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
