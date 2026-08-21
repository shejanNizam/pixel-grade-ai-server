import { Types } from "mongoose";

export type TSlabOrderStatus =
  | "order_received"
  | "processing"
  | "ready_to_ship"
  | "shipped"
  | "in_transit"
  | "delivered"
  | "shipping_exception"
  | "shipping_error"
  | "pending"
  | "cancelled";

export type TPaymentStatus = "pending" | "paid" | "failed";

export interface IShippingAddress {
  fullName: string;
  phone?: string;
  streetAddress: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface ISlabOrderItem {
  slab: Types.ObjectId;
  cardName: string;
  grade: number;
  gradeLabel: string;
  compositeUrl: string;
  price: number;
}

export interface IShippoInfo {
  shipmentId?: string;
  rateId?: string;
  transactionId?: string;
  labelUrl?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
}

export interface ISlabOrder {
  _id: string;
  orderNumber: string;
  user: Types.ObjectId;
  items: ISlabOrderItem[];
  /** Legacy single-slab compatibility */
  slab?: Types.ObjectId;
  slabLabel?: Types.ObjectId;
  report?: Types.ObjectId;
  shippingAddress: IShippingAddress;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  shippingFee: number;
  taxAmount: number;
  totalAmount: number;
  amount?: number;
  shippingCarrier?: string;
  paymentStatus: TPaymentStatus;
  orderStatus: TSlabOrderStatus;
  status?: string;
  trackingNumber?: string;
  shippo?: IShippoInfo;
  stripePaymentIntentId?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ISlabOrderInitial {
  slabId?: string;
  shippingAddress: IShippingAddress;
  quantity?: number;
  shippingFee?: number;
  taxAmount?: number;
}
