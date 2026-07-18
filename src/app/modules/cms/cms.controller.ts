import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { CmsSlug } from "./cms.interface";
import { CmsServices } from "./cms.service";

/** The slug comes from the URL, so it is validated here rather than by the
 *  body-only validateRequest middleware. */
const parseSlug = (value: string): CmsSlug => {
  if (!Object.values(CmsSlug).includes(value as CmsSlug)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Unknown page "${value}". Expected one of: ${Object.values(CmsSlug).join(", ")}.`,
    );
  }
  return value as CmsSlug;
};

const getPage = catchAsync(async (req: Request, res: Response) => {
  const slug = parseSlug(req.params.slug as string);
  const result = await CmsServices.getPage(slug);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Page retrieved successfully!",
    data: result,
  });
});

const getAllPages = catchAsync(async (_req: Request, res: Response) => {
  const result = await CmsServices.getAllPages();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pages retrieved successfully!",
    data: result,
  });
});

const updatePage = catchAsync(async (req: Request, res: Response) => {
  const { _id: adminId } = req.user as JwtPayload;
  const slug = parseSlug(req.params.slug as string);
  const result = await CmsServices.updatePage(
    slug,
    req.body.htmlContent,
    adminId as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Page updated successfully!",
    data: result,
  });
});

export const CmsControllers = {
  getPage,
  getAllPages,
  updatePage,
};
