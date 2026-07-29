import { Document, Types } from "mongoose";

export enum UserRole {
  user = "user",
  admin = "admin",
  super_admin = "super_admin",
}

export interface IAvatar {
  url: string;
  publicId: string;
}

export interface IUserInitial {
  _id?: Types.ObjectId;
  name: string;
  /** Public handle shown on the Creator Profile in place of the email address
   *  (client, 2026-07-29). Optional: accounts created before this existed, and
   *  Google sign-ups, have no username until the user picks one. Unique when
   *  present, lower-cased on write so "Ash" and "ash" cannot both be taken. */
  username?: string;
  email: string;
  phone?: string;
  password?: string;
  role: UserRole;
  avatar?: IAvatar;
  isEmailVerified: boolean;
  status: "active" | "blocked";
  blockReason?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  lastLoginAt?: Date;
}

export type IUser = IUserInitial & Document;
