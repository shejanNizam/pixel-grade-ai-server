import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ShippoService } from "../../services/shippo.service";

const validateAddress = catchAsync(async (req: Request, res: Response) => {
  const result = await ShippoService.validateAddress(req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Address validated successfully",
    data: result,
  });
});

const getRates = catchAsync(async (req: Request, res: Response) => {
  const { address, count } = req.body;
  const result = await ShippoService.getRatesForShipment(address, count);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Shippo rates retrieved successfully",
    data: result,
  });
});

export const ShippoController = {
  validateAddress,
  getRates,
};
