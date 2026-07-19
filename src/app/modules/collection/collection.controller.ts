import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { CollectionServices } from "./collection.service";

const getMyCollection = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CollectionServices.getMyCollection(
    userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Collection retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getSummary = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CollectionServices.getSummary(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Collection summary retrieved successfully!",
    data: result,
  });
});

const getValueOverTime = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CollectionServices.getValueOverTime(
    userId as string,
    Number(req.query.months) || 12,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Collection value over time retrieved successfully!",
    data: result,
  });
});

const getBySet = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CollectionServices.getBySet(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Collection by set retrieved successfully!",
    data: result,
  });
});

const addItem = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CollectionServices.addItem(userId as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Card added to collection successfully!",
    data: result,
  });
});

const getSingleItem = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CollectionServices.getSingleItem(
    userId as string,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Collection item retrieved successfully!",
    data: result,
  });
});

const updateItem = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CollectionServices.updateItem(
    userId as string,
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Collection item updated successfully!",
    data: result,
  });
});

const removeItem = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  await CollectionServices.removeItem(
    userId as string,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Card removed from collection successfully!",
    data: null,
  });
});

export const CollectionControllers = {
  getMyCollection,
  getSummary,
  getValueOverTime,
  getBySet,
  addItem,
  getSingleItem,
  updateItem,
  removeItem,
};
