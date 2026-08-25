import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { SlabLabel } from "../slab/slab.model";
import { SlabOrder } from "./slabOrder.model";
import { CartService } from "../cart/cart.service";
import { ShippoService } from "../../services/shippo.service";
import { createSlabCheckoutSession, isStripeConfigured } from "../../services/stripe.service";
import { configs } from "../../config";
import { sendEmail } from "../../utils/sendEmail";
import { logger } from "../../utils/logger";

const UNIT_PRICE = 24.99;
const TAX_RATE = 0.085; // 8.50% tax per client spec

/** Generates human-readable order number like #PG-10023 */
const generateOrderNumber = async (): Promise<string> => {
  let unique = false;
  let orderNum = "";
  while (!unique) {
    const random = Math.floor(10000 + Math.random() * 90000);
    orderNum = `#PG-${random}`;
    const existing = await SlabOrder.findOne({ orderNumber: orderNum });
    if (!existing) unique = true;
  }
  return orderNum;
};

const createOrder = async (userId: string, payload: any) => {
  const orderNumber = await generateOrderNumber();

  // Support multi-item cart OR single slab fallback
  let items: any[] = [];

  if (Array.isArray(payload.items) && payload.items.length > 0) {
    items = payload.items.map((i: any) => ({
      ...(i.slab || i.slabId ? { slab: i.slab || i.slabId } : {}),
      cardName: i.cardName || "PixelScope Digital Magnifier",
      grade: i.grade ?? 10,
      gradeLabel: i.gradeLabel || "HARDWARE",
      compositeUrl: i.compositeUrl || "/assets/pixelscope/hero.jpg",
      price: i.price ?? 69.99,
    }));
  } else {
    const targetId = payload.slabId || payload.slab || payload.slabLabel;
    if (targetId) {
      const slab = await SlabLabel.findById(targetId).populate("report");
      if (slab) {
        const report = slab.report as any;
        items.push({
          slab: slab._id,
          cardName: report?.card?.name || "Custom Slab",
          grade: report?.grade || 10,
          gradeLabel: report?.gradeLabel || "GEM-MINT",
          compositeUrl: slab.compositeUrl || slab.exportPngUrl || "",
          price: UNIT_PRICE,
        });
      }
    }
  }

  if (items.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Order must contain at least one item.");
  }

  const quantity = items.length;
  const subtotal = items.reduce(
    (sum, item) => sum + (item.price || UNIT_PRICE) * (item.quantity || 1),
    0,
  );

  let shippingFee = payload.shippingFee ?? (subtotal >= 50 ? 0 : 5.95);
  let shippoData: any = undefined;

  if (payload.shippingAddress) {
    try {
      const shippoResult = await ShippoService.getRatesForShipment(
        payload.shippingAddress,
        quantity,
      );
      if (shippoResult.selectedRate) {
        shippingFee = shippoResult.selectedRate.amount;
        shippoData = {
          shipmentId: shippoResult.shipmentId,
          rateId: shippoResult.selectedRate.rateId,
          carrier: shippoResult.selectedRate.provider,
        };
      }
    } catch (err: any) {
      logger.warn("Shippo rate estimation warning:", err.message);
    }
  }

  const taxAmount = payload.taxAmount ?? Number((subtotal * TAX_RATE).toFixed(2));
  const totalAmount = Number((subtotal + shippingFee + taxAmount).toFixed(2));

  const primarySlab = items[0]?.slab;

  const order = await SlabOrder.create({
    orderNumber,
    user: userId,
    items,
    slab: primarySlab,
    slabLabel: primarySlab,
    shippingAddress: payload.shippingAddress,
    quantity,
    unitPrice: UNIT_PRICE,
    subtotal,
    shippingFee,
    taxAmount,
    totalAmount,
    amount: totalAmount,
    shippingCarrier: shippoData?.carrier || "USPS",
    paymentStatus: payload.paymentStatus || "paid",
    orderStatus: payload.paymentStatus === "paid" ? "order_received" : "pending",
    status: payload.paymentStatus === "paid" ? "order_received" : "pending",
    stripePaymentIntentId: payload.stripePaymentIntentId,
    shippo: shippoData,
    notes: payload.notes,
  });

  const populatedOrder = await order.populate([
    { path: "user", select: "name email phone username avatar" },
    { path: "items.slab" },
  ]);

  // Send automated Order Received Confirmation Email (Email 1) upon successful payment
  const userObj = populatedOrder.user as any;
  const recipientEmail = userObj?.email;
  if (recipientEmail) {
    try {
      await sendEmail({
        to: recipientEmail,
        subject: `Order Confirmation — ${populatedOrder.orderNumber}`,
        templateName: "orderConfirmation",
        templateData: {
          name: populatedOrder.shippingAddress?.fullName || userObj?.name || "Collector",
          orderId: populatedOrder.orderNumber,
          quantity: populatedOrder.quantity,
          subtotal: populatedOrder.subtotal?.toFixed(2),
          shippingFee: populatedOrder.shippingFee?.toFixed(2),
          taxAmount: populatedOrder.taxAmount?.toFixed(2),
          totalAmount: populatedOrder.totalAmount?.toFixed(2),
          shippingAddress: populatedOrder.shippingAddress,
          isShipped: false,
        },
      });
    } catch (err) {
      logger.error("Failed to send order confirmation email", { error: err });
    }
  }

  return populatedOrder;
};

/** Create Stripe Checkout Session for Physical Slab Order */
const createStripeCheckout = async (userId: string, payload: any) => {
  const { items, shippingFee = 5.95, taxAmount = 0 } = payload;

  if (!items || items.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Order must contain at least one item.");
  }

  // Create pending order in database first
  const order = await createOrder(userId, {
    ...payload,
    paymentStatus: "pending",
  });

  const successUrl = `${configs.frontend_url}/user-dashboard/slab-orders?checkout=success&orderId=${order._id}`;
  const cancelUrl = `${configs.frontend_url}/user-dashboard/checkout?checkout=cancelled`;

  if (isStripeConfigured()) {
    const session = await createSlabCheckoutSession({
      items: (order.items || []).map((i: any) => ({
        name: i.cardName || "Custom Slab",
        amountInCents: Math.round((i.price || UNIT_PRICE) * 100),
        quantity: 1,
      })),
      shippingFee: order.shippingFee || shippingFee,
      taxAmount: order.taxAmount || taxAmount,
      successUrl,
      cancelUrl,
      metadata: {
        type: "physical_slab_order",
        orderId: String(order._id),
        userId: String(userId),
      },
    });
    return session;
  }

  // Fallback if Stripe key is missing: mark paid immediately
  await handleStripePaymentSuccess(String(order._id));
  return { url: successUrl };
};

/** Called when Stripe payment succeeds (via Webhook or frontend confirmation) */
const handleStripePaymentSuccess = async (orderId: string, paymentIntentId?: string) => {
  const order = await SlabOrder.findById(orderId);
  if (!order) return null;

  if (order.paymentStatus !== "paid") {
    order.paymentStatus = "paid";
    order.orderStatus = "order_received";
    order.status = "order_received";
    if (paymentIntentId) {
      order.stripePaymentIntentId = paymentIntentId;
    }
    await order.save();

    // Clear user's cart in database
    if (order.user) {
      await CartService.clearCart(String(order.user));
    }

    // Send Order Confirmation Email 1
    const populatedOrder = await order.populate([
      { path: "user", select: "name email phone username avatar" },
      { path: "items.slab" },
    ]);
    const userObj = populatedOrder.user as any;
    if (userObj?.email) {
      try {
        await sendEmail({
          to: userObj.email,
          subject: `Order Confirmation — ${populatedOrder.orderNumber}`,
          templateName: "orderConfirmation",
          templateData: {
            name: populatedOrder.shippingAddress?.fullName || userObj?.name || "Collector",
            orderId: populatedOrder.orderNumber,
            quantity: populatedOrder.quantity,
            subtotal: populatedOrder.subtotal?.toFixed(2),
            shippingFee: populatedOrder.shippingFee?.toFixed(2),
            taxAmount: populatedOrder.taxAmount?.toFixed(2),
            totalAmount: populatedOrder.totalAmount?.toFixed(2),
            shippingAddress: populatedOrder.shippingAddress,
            isShipped: false,
          },
        });
      } catch (err) {
        logger.error("Failed to send order confirmation email", { error: err });
      }
    }
    return populatedOrder;
  }
  return order;
};

/** Admin action: Purchases real shipping label via Shippo and updates status to shipped */
const purchaseOrderLabel = async (orderId: string, customRateId?: string) => {
  const order = await SlabOrder.findById(orderId).populate("user");
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Slab order not found");
  }

  const userObj = order.user as any;

  // Sanitize address for Shippo API (USPS requires valid US ZIP and 2-letter state code)
  const isTestMode =
    process.env.NODE_ENV === "development" ||
    process.env.SHIPPO_API_KEY?.startsWith("shippo_test_");

  const rawZip = order.shippingAddress.postalCode || "";
  const rawState = order.shippingAddress.state || "";
  const isValidUSZip = /^\d{5}(-\d{4})?$/.test(rawZip.trim());
  const isValidUSState = /^[A-Za-z]{2}$/.test(rawState.trim());

  const addressWithContact = {
    name: order.shippingAddress.fullName || userObj?.name || "Customer",
    phone: order.shippingAddress.phone || userObj?.phone || "7075550199",
    email: userObj?.email || "fulfillment@pixelgradeai.com",
    street1:
      isTestMode && (!isValidUSZip || !isValidUSState || order.shippingAddress.city?.toLowerCase().includes("dhaka"))
        ? "112 Commercial Ct"
        : order.shippingAddress.streetAddress,
    city:
      isTestMode && (!isValidUSZip || !isValidUSState || order.shippingAddress.city?.toLowerCase().includes("dhaka"))
        ? "Santa Rosa"
        : order.shippingAddress.city,
    state:
      isTestMode && (!isValidUSZip || !isValidUSState)
        ? "CA"
        : rawState.trim().toUpperCase(),
    zip:
      isTestMode && (!isValidUSZip || !isValidUSState)
        ? "95407"
        : rawZip.trim(),
    country: "US",
  };

  let rateIdToUse = customRateId || order.shippo?.rateId;

  // If rate ID is missing or a fallback string, create a live shipment on Shippo API to get a real rate ID
  if (
    !rateIdToUse ||
    rateIdToUse.startsWith("fallback") ||
    rateIdToUse.startsWith("usps_ground") ||
    rateIdToUse.startsWith("estimated")
  ) {
    const liveShipment = await ShippoService.getRatesForShipment(
      addressWithContact,
      order.quantity || 1,
    );
    if (liveShipment.selectedRate) {
      rateIdToUse = liveShipment.selectedRate.rateId;
    }
  }

  if (!rateIdToUse || rateIdToUse.startsWith("fallback") || rateIdToUse.startsWith("usps_ground") || rateIdToUse.startsWith("estimated")) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Unable to obtain a valid live rate from Shippo API. Please verify Shippo API credentials.",
    );
  }

  let transaction: any;
  try {
    transaction = await ShippoService.purchaseLabel(rateIdToUse);
  } catch (err) {
    // If saved rateId expired on Shippo, refresh live shipment rates and retry once
    const liveShipment = await ShippoService.getRatesForShipment(
      addressWithContact,
      order.quantity || 1,
    );
    if (!liveShipment.selectedRate?.rateId || liveShipment.selectedRate.rateId.startsWith("fallback") || liveShipment.selectedRate.rateId.startsWith("usps_ground")) {
      throw err;
    }
    transaction = await ShippoService.purchaseLabel(liveShipment.selectedRate.rateId);
  }

  order.shippo = {
    ...order.shippo,
    transactionId: transaction.transactionId,
    labelUrl: transaction.labelUrl,
    trackingNumber: transaction.trackingNumber,
    trackingUrl: transaction.trackingUrl,
    carrier: transaction.carrier,
  };
  order.trackingNumber = transaction.trackingNumber;
  order.orderStatus = "shipped";
  order.status = "shipped";

  await order.save();

  // Trigger Real Shipping Notification Email 2 to customer
  const recipientEmail = userObj?.email;
  if (recipientEmail) {
    try {
      await sendEmail({
        to: recipientEmail,
        subject: `Your PixelGrade Order ${order.orderNumber} Has Shipped!`,
        templateName: "orderConfirmation", // reusing or sending shipping email template
        templateData: {
          name: order.shippingAddress?.fullName || userObj?.name || "Collector",
          orderId: order.orderNumber,
          quantity: order.quantity,
          subtotal: order.subtotal?.toFixed(2),
          shippingFee: order.shippingFee?.toFixed(2),
          taxAmount: order.taxAmount?.toFixed(2),
          totalAmount: order.totalAmount?.toFixed(2),
          trackingNumber: transaction.trackingNumber,
          trackingUrl: transaction.trackingUrl,
          labelUrl: transaction.labelUrl,
          shippingAddress: order.shippingAddress,
          isShipped: true,
        },
      });
    } catch (err) {
      logger.error("Failed to send shipping email notification", { error: err });
    }
  }

  return order;
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
        { path: "items.slab" },
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
        { path: "items.slab" },
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

const getOrderById = async (orderId: string) => {
  const order = await SlabOrder.findById(orderId).populate([
    { path: "user", select: "name email phone username avatar" },
    { path: "items.slab" },
  ]);
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Slab order not found");
  }
  return order;
};

const updateOrderStatus = async (
  orderId: string,
  payload: { orderStatus?: string; trackingNumber?: string; notes?: string },
) => {
  const order = await SlabOrder.findById(orderId);
  if (!order) {
    throw new AppError(httpStatus.NOT_FOUND, "Slab order not found");
  }

  if (payload.orderStatus) {
    order.orderStatus = payload.orderStatus as any;
    order.status = payload.orderStatus;
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
    { path: "items.slab" },
  ]);
};

export const SlabOrderServices = {
  createOrder,
  createStripeCheckout,
  handleStripePaymentSuccess,
  purchaseOrderLabel,
  getMyOrders,
  getAllOrders,
  getOrderById,
  updateOrderStatus,
};
