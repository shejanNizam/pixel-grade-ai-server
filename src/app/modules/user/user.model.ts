import { model, Schema } from "mongoose";
import { IUser, UserRole } from "./user.interface";

export const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, select: false },
    phone: { type: String },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.user,
    },
    avatar: {
      url: { type: String },
      publicId: { type: String },
    },
    isEmailVerified: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "blocked"], default: "active" },
    blockReason: { type: String },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.index({ role: 1, status: 1 });

export const User = model<IUser>("User", userSchema);
