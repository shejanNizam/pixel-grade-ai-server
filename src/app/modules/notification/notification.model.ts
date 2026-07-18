import { model, Schema } from "mongoose";
import {
  INotification,
  INotificationSettings,
  NotifType,
} from "./notification.interface";

export const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: Object.values(NotifType), required: true },
    title: { type: String, required: true },
    body: { type: String },
    isRead: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Backs both the paginated history and the unread-count badge.
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

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
