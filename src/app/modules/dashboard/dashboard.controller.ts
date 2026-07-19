import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { DashboardServices } from "./dashboard.service";

const getAdminOverview = catchAsync(async (_req: Request, res: Response) => {
  const result = await DashboardServices.getAdminOverview();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin overview retrieved successfully!",
    data: result,
  });
});

const getUserOverview = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await DashboardServices.getUserOverview(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dashboard overview retrieved successfully!",
    data: result,
  });
});

export const DashboardControllers = {
  getAdminOverview,
  getUserOverview,
};
