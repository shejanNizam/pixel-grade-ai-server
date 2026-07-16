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
