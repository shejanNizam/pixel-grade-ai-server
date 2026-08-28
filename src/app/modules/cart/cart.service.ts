import { Types } from "mongoose";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { SlabLabel } from "../slab/slab.model";
import { GradingReport } from "../grading/grading.model";
import { Card } from "../card/card.model";
import { Cart } from "./cart.model";
import { ICartItem } from "./cart.interface";

const UNIT_PRICE = 5.99;

export interface IAddToCartPayload {
  slabId?: string;
  itemType?: string;
  cardName?: string;
  quantity?: number;
  compositeUrl?: string;
  price?: number;
}

const getCart = async (userId: string) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  } else {
    // Auto-migrate legacy custom slab items from $24.99 to $5.99
    let updated = false;
    cart.items.forEach((item) => {
      if (item.gradeLabel !== "HARDWARE" && item.price === 24.99) {
        item.price = UNIT_PRICE;
        updated = true;
      }
    });
    if (updated) {
      await cart.save();
    }
  }
  return cart;
};

const addToCart = async (userId: string, payload: IAddToCartPayload | string) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }

  const payloadObj = typeof payload === "object" ? payload : undefined;
  const slabId = typeof payload === "string" ? payload : payloadObj?.slabId;
  const isHardware = payloadObj?.itemType === "hardware" || payloadObj?.cardName?.includes("PixelScope");

  const reqQuantity = Math.max(1, Number(payloadObj?.quantity) || 1);

  if (isHardware || (!slabId && payloadObj?.cardName)) {
    const cardName = payloadObj?.cardName || "PixelScope Digital Magnifier";
    const compositeUrl = payloadObj?.compositeUrl || "/assets/pixelscope/pixelscope_image_one.PNG";
    const price = payloadObj?.price || 69.99;

    const existingIndex = cart.items.findIndex(
      (item) => item.cardName === cardName
    );

    if (existingIndex > -1) {
      cart.items[existingIndex].price = price;
      cart.items[existingIndex].compositeUrl = compositeUrl;
      cart.items[existingIndex].quantity = (cart.items[existingIndex].quantity || 1) + reqQuantity;
    } else {
      cart.items.push({
        cardName,
        grade: 10,
        gradeLabel: "HARDWARE",
        compositeUrl,
        price,
        quantity: reqQuantity,
        addedAt: new Date(),
      } as ICartItem);
    }
  } else if (slabId) {
    const slab = await SlabLabel.findById(slabId);
    if (!slab) {
      throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");
    }

    const report = await GradingReport.findById(slab.report);
    if (!report) {
      throw new AppError(httpStatus.NOT_FOUND, "Grading report not found");
    }

    const card = await Card.findById(report.card);
    const cardName = card?.name ?? "Custom Slab";
    const compositeUrl = slab.compositeUrl ?? slab.exportPngUrl ?? "";

    // Each custom slab is Quantity 1 per spec. Avoid duplicate slab entry if already in cart.
    const existingIndex = cart.items.findIndex(
      (item) => item.slab && item.slab.toString() === slabId,
    );

    if (existingIndex > -1) {
      cart.items[existingIndex].price = UNIT_PRICE;
      cart.items[existingIndex].compositeUrl = compositeUrl;
      cart.items[existingIndex].cardName = cardName;
      cart.items[existingIndex].grade = report.grade;
      cart.items[existingIndex].gradeLabel = report.gradeLabel;
    } else {
      cart.items.push({
        slab: slab._id as Types.ObjectId,
        cardName,
        grade: report.grade,
        gradeLabel: report.gradeLabel,
        compositeUrl,
        price: UNIT_PRICE,
        addedAt: new Date(),
      });
    }
  } else {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid item payload for cart.");
  }

  await cart.save();
  return cart;
};

const removeFromCart = async (userId: string, itemId: string) => {
  const cart = await Cart.findOne({ user: userId });
  if (!cart) {
    throw new AppError(httpStatus.NOT_FOUND, "Cart not found");
  }

  cart.items = cart.items.filter((item) => (item as ICartItem & { _id: Types.ObjectId })._id.toString() !== itemId);
  await cart.save();
  return cart;
};

const clearCart = async (userId: string) => {
  const cart = await Cart.findOne({ user: userId });
  if (cart) {
    cart.items = [];
    await cart.save();
  }
  return cart;
};

export const CartService = {
  getCart,
  addToCart,
  removeFromCart,
  clearCart,
};
