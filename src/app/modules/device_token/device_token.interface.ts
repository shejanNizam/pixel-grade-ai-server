import { Document, Types } from "mongoose";

export type DevicePlatform = "ios" | "android" | "web";

export interface IDeviceTokenInitial {
  userId: Types.ObjectId;
  token: string;
  platform: DevicePlatform;
  lastActiveAt?: Date;
}

export type IDeviceToken = IDeviceTokenInitial & Document;
