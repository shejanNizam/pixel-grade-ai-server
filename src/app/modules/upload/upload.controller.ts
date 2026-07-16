import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";

type CloudinaryFile = Express.Multer.File & { path: string };

const toFileResult = (file: CloudinaryFile) => ({
  url: file.path,
  publicId: file.filename,
});

const uploadFiles = catchAsync(async (req: Request, res: Response) => {
  const files = req.files as CloudinaryFile[] | undefined;

  if (!files || files.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "No file provided");
  }

  const data =
    files.length === 1
      ? toFileResult(files[0])
      : files.map(toFileResult);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `${files.length} file(s) uploaded successfully`,
    data,
  });
});

export const UploadControllers = { uploadFiles };
