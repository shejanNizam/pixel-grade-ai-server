import { Types } from "mongoose";

export type TSlabOrderStatus = "pending" | "processing" | "shipped" | "delivered" | "cancelled";
export type TPaymentStatus = "pending" | "paid" | "failed";

export interface IShippingAddress {
  fullName: string;
  phone: string;
  streetAddress: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface ISlabOrder {
  _id: string;
  user: Types.ObjectId;
  slab: Types.ObjectId;
  slabLabel?: Types.ObjectId;
  report?: Types.ObjectId;
  shippingAddress: IShippingAddress;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  amount?: number;
  paymentStatus: TPaymentStatus;
  orderStatus: TSlabOrderStatus;
  status?: string;
  trackingNumber?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ISlabOrderInitial {
  slabId: string;
  shippingAddress: IShippingAddress;
  quantity?: number;
}
