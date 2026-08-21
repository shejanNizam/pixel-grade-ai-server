import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { SlabLabel } from "../slab/slab.model";
import { GradingReport } from "../grading/grading.model";
import { Card } from "../card/card.model";
import { Cart } from "./cart.model";

const UNIT_PRICE = 24.99;

const getCart = async (userId: string) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }
  return cart;
};

const addToCart = async (userId: string, slabId: string) => {
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

  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }

  // Each custom slab is Quantity 1 per spec. Avoid duplicate slab entry if already in cart.
  const existingIndex = cart.items.findIndex(
    (item) => item.slab.toString() === slabId,
  );

  if (existingIndex > -1) {
    // Update compositeUrl / pricing if re-generated
    cart.items[existingIndex].compositeUrl = compositeUrl;
    cart.items[existingIndex].cardName = cardName;
    cart.items[existingIndex].grade = report.grade;
    cart.items[existingIndex].gradeLabel = report.gradeLabel;
  } else {
    cart.items.push({
      slab: slab._id as any,
      cardName,
      grade: report.grade,
      gradeLabel: report.gradeLabel,
      compositeUrl,
      price: UNIT_PRICE,
      addedAt: new Date(),
    });
  }

  await cart.save();
  return cart;
};

const removeFromCart = async (userId: string, itemId: string) => {
  const cart = await Cart.findOne({ user: userId });
  if (!cart) {
    throw new AppError(httpStatus.NOT_FOUND, "Cart not found");
  }

  cart.items = cart.items.filter((item) => (item as any)._id.toString() !== itemId);
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
