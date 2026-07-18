import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ActivityLogServices } from "./activity_log.service";

const getAllLogs = catchAsync(async (req: Request, res: Response) => {
  const result = await ActivityLogServices.getAllLogs(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Activity logs retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

export const ActivityLogControllers = {
  getAllLogs,
};
