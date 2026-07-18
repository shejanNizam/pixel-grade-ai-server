import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PlanServices } from "./plan.service";

const getAllPlans = catchAsync(async (_req: Request, res: Response) => {
  const result = await PlanServices.getAllPlans();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plans retrieved successfully!",
    data: result,
  });
});

const getAllPlansForAdmin = catchAsync(async (_req: Request, res: Response) => {
  const result = await PlanServices.getAllPlansForAdmin();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plans retrieved successfully!",
    data: result,
  });
});

const getSinglePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanServices.getSinglePlan(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan retrieved successfully!",
    data: result,
  });
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanServices.updatePlan(
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan updated successfully!",
    data: result,
  });
});

export const PlanControllers = {
  getAllPlans,
  getAllPlansForAdmin,
  getSinglePlan,
  updatePlan,
};
