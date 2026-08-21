import { Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { SlabOrderServices } from "./slabOrder.service";

const createOrder = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabOrderServices.createOrder(userId as string, req.body);
  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Physical slab order placed successfully!",
    data: result,
  });
});

const createStripeCheckout = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabOrderServices.createStripeCheckout(userId as string, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Stripe Checkout session created successfully!",
    data: result,
  });
});

const getMyOrders = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabOrderServices.getMyOrders(userId as string, req.query);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Fetched slab orders successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getAllOrders = catchAsync(async (req: Request, res: Response) => {
  const result = await SlabOrderServices.getAllOrders({
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    status: req.query.status as string | undefined,
  });
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Fetched all slab orders successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getOrderById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SlabOrderServices.getOrderById(id as string);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Fetched order successfully",
    data: result,
  });
});

const purchaseLabel = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { rateId } = req.body;
  const result = await SlabOrderServices.purchaseOrderLabel(id as string, rateId);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Shipping label purchased successfully via Shippo!",
    data: result,
  });
});

const updateOrderStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SlabOrderServices.updateOrderStatus(id as string, req.body);
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Order status updated successfully",
    data: result,
  });
});

export const SlabOrderControllers = {
  createOrder,
  createStripeCheckout,
  getMyOrders,
  getAllOrders,
  getOrderById,
  purchaseLabel,
  updateOrderStatus,
};
