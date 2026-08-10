import AppError from "../../errorHelpers/AppError";
import { SlabLabel } from "../slab/slab.model";
import { ISlabOrderInitial } from "./slabOrder.interface";
import { SlabOrder } from "./slabOrder.model";

const PHYSICAL_SLAB_UNIT_PRICE = 9.99; // $9.99 sale price per custom physical slab
const USPS_SHIPPING_FEE = 4.99; // $4.99 USPS Flat Rate
const TAX_RATE = 0.08; // 8% Estimated Tax Rate

const createOrder = async (userId: string, payload: any) => {
  const targetId = payload.slabId || payload.slabLabel;
  const slab = await SlabLabel.findById(targetId).populate("report");
  if (!slab) {
    throw new AppError(404, "Slab label not found");
  }

  const quantity = Math.max(1, payload.quantity ?? 1);
  const subtotal = Number((quantity * PHYSICAL_SLAB_UNIT_PRICE).toFixed(2));
  const shippingFee = payload.shippingFee ?? USPS_SHIPPING_FEE;
  const taxAmount = payload.taxAmount ?? Number((subtotal * TAX_RATE).toFixed(2));
  const totalAmount = Number((subtotal + shippingFee + taxAmount).toFixed(2));

  // Auto-generate USPS Tracking Number upon checkout submission
  const autoTrackingNumber = `USPS-9400111899${Math.floor(100000 + Math.random() * 900000)}`;

  const order = await SlabOrder.create({
    user: userId,
    slab: slab._id,
    slabLabel: slab._id,
    report: slab.report,
    shippingAddress: payload.shippingAddress,
    quantity,
    unitPrice: PHYSICAL_SLAB_UNIT_PRICE,
    subtotal,
    shippingFee,
    taxAmount,
    totalAmount,
    amount: totalAmount,
    shippingCarrier: "USPS",
    paymentStatus: "paid",
    orderStatus: "processing",
    status: "processing",
    trackingNumber: autoTrackingNumber,
    notes: "Order placed & shipping label created via USPS Standard Service.",
  });

  return await order.populate([
    { path: "user", select: "name email phone username avatar" },
    {
      path: "slab",
      populate: { path: "report", populate: { path: "card" } },
    },
  ]);
};

const getMyOrders = async (
  userId: string,
  query: { page?: number; limit?: number },
) => {
  const page = Math.max(1, Number(query.page ?? 1));
  const limit = Math.max(1, Number(query.limit ?? 20));
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    SlabOrder.find({ user: userId })
      .sort("-createdAt")
      .skip(skip)
      .limit(limit)
      .populate([
        { path: "user", select: "name email phone username avatar" },
        {
          path: "slab",
          populate: { path: "report", populate: { path: "card" } },
        },
      ]),
    SlabOrder.countDocuments({ user: userId }),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit) || 1,
    },
  };
};

const getAllOrders = async (query: {
  page?: number;
  limit?: number;
  status?: string;
}) => {
  const page = Math.max(1, Number(query.page ?? 1));
  const limit = Math.max(1, Number(query.limit ?? 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (query.status) {
    filter.orderStatus = query.status;
  }

  const [data, total] = await Promise.all([
    SlabOrder.find(filter)
      .sort("-createdAt")
      .skip(skip)
      .limit(limit)
      .populate([
        { path: "user", select: "name email phone username avatar" },
        {
          path: "slab",
          populate: { path: "report", populate: { path: "card" } },
        },
      ]),
    SlabOrder.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit) || 1,
    },
  };
};

const updateOrderStatus = async (
  orderId: string,
  payload: { orderStatus?: string; trackingNumber?: string; notes?: string },
) => {
  const order = await SlabOrder.findById(orderId);
  if (!order) {
    throw new AppError(404, "Slab order not found");
  }

  if (payload.orderStatus) {
    order.orderStatus = payload.orderStatus as any;
  }
  if (payload.trackingNumber !== undefined) {
    order.trackingNumber = payload.trackingNumber;
  }
  if (payload.notes !== undefined) {
    order.notes = payload.notes;
  }

  await order.save();
  return await order.populate([
    { path: "user", select: "name email phone username avatar" },
    {
      path: "slab",
      populate: { path: "report", populate: { path: "card" } },
    },
  ]);
};

export const SlabOrderServices = {
  createOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
};
