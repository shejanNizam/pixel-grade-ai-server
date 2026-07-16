import { Document, Types } from "mongoose";

export type AuthProvider = "local" | "google" | "apple";

export interface IAuthIdentityInitial {
  userId: Types.ObjectId;
  provider: AuthProvider;
  providerId: string;
}

export type IAuthIdentity = IAuthIdentityInitial & Document;
