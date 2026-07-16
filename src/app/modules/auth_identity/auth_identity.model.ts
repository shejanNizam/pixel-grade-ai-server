import { model, Schema } from "mongoose";
import { IAuthIdentity } from "./auth_identity.interface";

const authIdentitySchema = new Schema<IAuthIdentity>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    provider: {
      type: String,
      enum: ["local", "google", "apple"],
      required: true,
    },
    providerId: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);

authIdentitySchema.index({ provider: 1, providerId: 1 }, { unique: true });
authIdentitySchema.index({ userId: 1 });

export const AuthIdentity = model<IAuthIdentity>(
  "AuthIdentity",
  authIdentitySchema,
);
