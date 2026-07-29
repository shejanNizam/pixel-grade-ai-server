import { model, Schema } from "mongoose";
import {
  INotification,
  INotificationSettings,
  NotifAudience,
  NotifType,
} from "./notification.interface";

export const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: Object.values(NotifType), required: true },
    audience: {
      type: String,
      enum: Object.values(NotifAudience),
      required: true,
      default: NotifAudience.user,
    },
    title: { type: String, required: true },
    body: { type: String },
    isRead: { type: Boolean, default: false },
    link: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Every read path is "this recipient, this audience" — the two dashboards ask
// for different audiences, and the unread badge is counted per audience so the
// admin bell does not include the admin's own personal notifications.
notificationSchema.index({ user: 1, audience: 1, isRead: 1, createdAt: -1 });

export const Notification = model<INotification>(
  "Notification",
  notificationSchema,
);

export const notificationSettingsSchema = new Schema<INotificationSettings>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    inappEnabled: { type: Boolean, default: true },
    emailGradeReady: { type: Boolean, default: true },
    emailPriceAlert: { type: Boolean, default: true },
    emailSubscription: { type: Boolean, default: true },
    emailSupport: { type: Boolean, default: true },
    // Off by default — see INotificationSettings.
    emailAdminAlerts: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const NotificationSettings = model<INotificationSettings>(
  "NotificationSettings",
  notificationSettingsSchema,
);
