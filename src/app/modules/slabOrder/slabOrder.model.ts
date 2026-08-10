import { Schema, model, models } from "mongoose";
import { ISlabOrder } from "./slabOrder.interface";

const ShippingAddressSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    streetAddress: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const SlabOrderSchema = new Schema<ISlabOrder>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    slab: { type: Schema.Types.ObjectId, ref: "SlabLabel", required: true },
    slabLabel: { type: Schema.Types.ObjectId, ref: "SlabLabel" },
    report: { type: Schema.Types.ObjectId, ref: "CardAnalysis" },
    shippingAddress: { type: ShippingAddressSchema, required: true },
    quantity: { type: Number, required: true, default: 1, min: 1 },
    unitPrice: { type: Number, required: true, default: 9.99 },
    subtotal: { type: Number, required: true, default: 9.99 },
    shippingFee: { type: Number, required: true, default: 4.99 },
    taxAmount: { type: Number, required: true, default: 0.8 },
    totalAmount: { type: Number, required: true },
    amount: { type: Number },
    shippingCarrier: { type: String, default: "USPS" },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "paid",
    },
    orderStatus: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
    status: {
      type: String,
      default: "pending",
    },
    trackingNumber: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

SlabOrderSchema.pre("save", function () {
  if (this.slab && !this.slabLabel) {
    this.slabLabel = this.slab;
  }
  if (this.totalAmount && !this.amount) {
    this.amount = this.totalAmount;
  }
  if (this.orderStatus && !this.status) {
    this.status = this.orderStatus as string;
  }
});

export const SlabOrder =
  models.SlabOrder || model<ISlabOrder>("SlabOrder", SlabOrderSchema);
