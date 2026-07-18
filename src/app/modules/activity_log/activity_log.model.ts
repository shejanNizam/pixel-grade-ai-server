import { model, Schema } from "mongoose";
import { ActivityAction, IActivityLog } from "./activity_log.interface";

export const activityLogSchema = new Schema<IActivityLog>(
  {
    // Optional by design — a failed login has an IP but no user.
    user: { type: Schema.Types.ObjectId, ref: "User" },
    action: {
      type: String,
      enum: Object.values(ActivityAction),
      required: true,
    },
    meta: { type: Schema.Types.Mixed },
    ipAddress: { type: String },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: -1 });

export const ActivityLog = model<IActivityLog>("ActivityLog", activityLogSchema);
