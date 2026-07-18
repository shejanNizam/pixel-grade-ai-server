import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { CardServices } from "./card.service";

const getAllCards = catchAsync(async (req: Request, res: Response) => {
  const result = await CardServices.getAllCards(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cards retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getSingleCard = catchAsync(async (req: Request, res: Response) => {
  const result = await CardServices.getSingleCard(req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Card retrieved successfully!",
    data: result,
  });
});

const getSets = catchAsync(async (_req: Request, res: Response) => {
  const result = await CardServices.getSets();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sets retrieved successfully!",
    data: result,
  });
});

export const CardControllers = {
  getAllCards,
  getSingleCard,
  getSets,
};
