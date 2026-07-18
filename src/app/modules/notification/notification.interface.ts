import { Document, Types } from "mongoose";

export enum NotifType {
  grade_ready = "grade_ready",
  price_alert = "price_alert",
  subscription = "subscription",
  support = "support",
  system = "system",
}

export interface INotificationInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  type: NotifType;
  title: string;
  body?: string;
  isRead: boolean;
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
}

export type INotificationSettings = INotificationSettingsInitial & Document;
