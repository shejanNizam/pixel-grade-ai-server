import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { GradingServices } from "./grading.service";

const gradeAnalysis = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await GradingServices.gradeAnalysis(
    userId as string,
    req.params.analysisId as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Grading report generated successfully!",
    data: result,
  });
});

const getMyReports = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await GradingServices.getMyReports(
    userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reports retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getReport = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId, role } = req.user as JwtPayload;
  const result = await GradingServices.getReport(
    req.params.id as string,
    userId as string,
    role as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Report retrieved successfully!",
    data: result,
  });
});

const getAllReports = catchAsync(async (req: Request, res: Response) => {
  const result = await GradingServices.getAllReports(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reports retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

/** Streams PDF bytes, not the JSON envelope — this is a file download. */
const downloadReportPdf = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId, role } = req.user as JwtPayload;
  const { pdf, reportId } = await GradingServices.getReportPdf(
    req.params.id as string,
    userId as string,
    role as string,
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="pixelgrade-report-${reportId}.pdf"`,
  );
  // The watermark tracks the owner's current plan, so this must not be cached.
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
});

export const GradingControllers = {
  gradeAnalysis,
  getMyReports,
  getReport,
  getAllReports,
  downloadReportPdf,
};
