import { Document, Types } from "mongoose";

export interface ICartItem {
  slab: Types.ObjectId;
  cardName: string;
  grade: number;
  gradeLabel: string;
  compositeUrl: string;
  price: number;
  addedAt: Date;
}

export interface ICart extends Document {
  user: Types.ObjectId;
  items: ICartItem[];
  createdAt: Date;
  updatedAt: Date;
}
