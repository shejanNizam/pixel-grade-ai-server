import { Schema, model, models } from "mongoose";
import { ISlabOrder } from "./slabOrder.interface";

const ShippingAddressSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    streetAddress: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: "US" },
  },
  { _id: false },
);

const SlabOrderItemSchema = new Schema(
  {
    slab: { type: Schema.Types.ObjectId, ref: "SlabLabel", required: false },
    cardName: { type: String, required: true },
    grade: { type: Number, required: true, default: 10 },
    gradeLabel: { type: String, required: true, default: "HARDWARE" },
    compositeUrl: { type: String, required: true },
    price: { type: Number, required: true, default: 24.99 },
  },
  { _id: true },
);

const ShippoInfoSchema = new Schema(
  {
    shipmentId: { type: String },
    rateId: { type: String },
    transactionId: { type: String },
    labelUrl: { type: String },
    trackingNumber: { type: String },
    trackingUrl: { type: String },
    carrier: { type: String, default: "USPS" },
  },
  { _id: false },
);

const SlabOrderSchema = new Schema<ISlabOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    items: [SlabOrderItemSchema],
    slab: { type: Schema.Types.ObjectId, ref: "SlabLabel" },
    slabLabel: { type: Schema.Types.ObjectId, ref: "SlabLabel" },
    report: { type: Schema.Types.ObjectId, ref: "CardAnalysis" },
    shippingAddress: { type: ShippingAddressSchema, required: true },
    quantity: { type: Number, required: true, default: 1, min: 1 },
    unitPrice: { type: Number, required: true, default: 24.99 },
    subtotal: { type: Number, required: true, default: 24.99 },
    shippingFee: { type: Number, required: true, default: 5.95 },
    taxAmount: { type: Number, required: true, default: 0 },
    totalAmount: { type: Number, required: true },
    amount: { type: Number },
    shippingCarrier: { type: String, default: "USPS" },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    orderStatus: {
      type: String,
      enum: [
        "order_received",
        "processing",
        "ready_to_ship",
        "shipped",
        "in_transit",
        "delivered",
        "shipping_exception",
        "shipping_error",
        "pending",
        "cancelled",
      ],
      default: "order_received",
    },
    status: {
      type: String,
      default: "order_received",
    },
    trackingNumber: { type: String, trim: true },
    shippo: { type: ShippoInfoSchema },
    stripePaymentIntentId: { type: String },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

SlabOrderSchema.pre("save", function () {
  if (this.totalAmount && !this.amount) {
    this.amount = this.totalAmount;
  }
  if (this.orderStatus && !this.status) {
    this.status = this.orderStatus as string;
  }
});

export const SlabOrder =
  models.SlabOrder || model<ISlabOrder>("SlabOrder", SlabOrderSchema);
