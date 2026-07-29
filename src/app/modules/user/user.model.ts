import { model, Schema } from "mongoose";
import { IUser, UserRole } from "./user.interface";

export const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    username: {
      type: String,
      trim: true,
      lowercase: true,
      // `sparse` is required, not cosmetic: a plain unique index treats every
      // user without a username as holding the same `null`, so the second
      // account created would collide on it.
      unique: true,
      sparse: true,
      minlength: 3,
      maxlength: 24,
      match: [
        /^[a-z0-9_]+$/,
        "Username may only contain lowercase letters, numbers, and underscores",
      ],
    },
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
