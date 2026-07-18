import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { CreditServices } from "./credit.service";

const getMyBalance = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CreditServices.getBalance(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Credit balance retrieved successfully!",
    data: result,
  });
});

const getMyLedger = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await CreditServices.getLedger(
    userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Credit history retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getUserLedger = catchAsync(async (req: Request, res: Response) => {
  const result = await CreditServices.getLedger(
    req.params.userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Credit history retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const adminAdjust = catchAsync(async (req: Request, res: Response) => {
  const { _id: adminId } = req.user as JwtPayload;
  const result = await CreditServices.adminAdjust(
    req.params.userId as string,
    req.body.amount,
    adminId as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Credits adjusted successfully!",
    data: result,
  });
});

export const CreditControllers = {
  getMyBalance,
  getMyLedger,
  getUserLedger,
  adminAdjust,
};
