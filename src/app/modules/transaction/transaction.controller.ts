import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { TransactionServices } from "./transaction.service";

const getMyTransactions = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await TransactionServices.getMyTransactions(
    userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Billing history retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getAllTransactions = catchAsync(async (req: Request, res: Response) => {
  const result = await TransactionServices.getAllTransactions(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Transactions retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getEarnings = catchAsync(async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  const result = await TransactionServices.getEarnings(from, to);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Earnings retrieved successfully!",
    data: result,
  });
});

const getRevenueByMonth = catchAsync(async (req: Request, res: Response) => {
  const months = Number(req.query.months) || 12;
  const result = await TransactionServices.getRevenueByMonth(months);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Revenue breakdown retrieved successfully!",
    data: result,
  });
});

export const TransactionControllers = {
  getMyTransactions,
  getAllTransactions,
  getEarnings,
  getRevenueByMonth,
};
