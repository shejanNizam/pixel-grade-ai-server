import { model, Schema } from "mongoose";
import { IDeviceToken } from "./device_token.interface";

const deviceTokenSchema = new Schema<IDeviceToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["ios", "android", "web"], required: true },
    lastActiveAt: { type: Date },
  },
  { timestamps: true, versionKey: false },
);

deviceTokenSchema.index({ userId: 1 });

export const DeviceToken = model<IDeviceToken>("DeviceToken", deviceTokenSchema);
