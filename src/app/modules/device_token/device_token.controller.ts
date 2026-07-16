import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { DeviceTokenServices } from "./device_token.service";

const upsertToken = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const token = await DeviceTokenServices.upsertToken({ ...req.body, userId });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Device token registered",
    data: token,
  });
});

const removeToken = catchAsync(async (req: Request, res: Response) => {
  await DeviceTokenServices.removeToken(req.body.token);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Device token removed",
    data: null,
  });
});

export const DeviceTokenControllers = { upsertToken, removeToken };
