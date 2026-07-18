import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { SLAB_STYLES, SlabStyle } from "../../constants";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { SlabServices } from "./slab.service";

const createLabel = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabServices.createLabel(
    userId as string,
    req.body.reportId,
    (req.body.styleId as SlabStyle) ?? SLAB_STYLES[0],
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Slab label generated successfully!",
    data: result,
  });
});

const regenerate = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabServices.regenerateBackground(
    userId as string,
    req.params.id as string,
    req.body.styleId as SlabStyle | undefined,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Background regenerated successfully!",
    data: result,
  });
});

/** Streams the PNG directly — a guide preview is a transient render and is
 *  deliberately not persisted to Cloudinary. */
const preview = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const png = await SlabServices.previewWithGuides(
    userId as string,
    req.params.id as string,
  );
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.status(httpStatus.OK).send(png);
});

const getMyLabels = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabServices.getMyLabels(
    userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Slab labels retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getLabel = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabServices.getLabel(
    userId as string,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Slab label retrieved successfully!",
    data: result,
  });
});

const getStyles = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Slab styles retrieved successfully!",
    data: SLAB_STYLES,
  });
});

export const SlabControllers = {
  createLabel,
  regenerate,
  preview,
  getMyLabels,
  getLabel,
  getStyles,
};
