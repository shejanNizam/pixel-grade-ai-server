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
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Four new artwork options generated successfully!",
    data: result,
  });
});

/** Switches the selected EXT. ART option. Costs nothing at the provider —
 *  all four were rendered when the batch was generated. */
const selectVariant = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SlabServices.selectVariant(
    userId as string,
    req.params.id as string,
    Number(req.body.variantIndex),
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Artwork selected successfully!",
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

export const SlabControllers = {
  createLabel,
  regenerate,
  selectVariant,
  preview,
  getMyLabels,
  getLabel,
};
