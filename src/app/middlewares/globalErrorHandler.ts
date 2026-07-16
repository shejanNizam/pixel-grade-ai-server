/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import { configs } from "../config/index";
import { deleteFromCloudinary } from "../config/cloudinary.config";
import { logger } from "../utils/logger";
import AppError from "../errorHelpers/AppError";
import { handleCastError } from "../helpers/handleCastError";
import { handlerDuplicateError } from "../helpers/handlerDuplicateError";
import { handlerValidationError } from "../helpers/handlerValidationError";
import { handlerZodError } from "../helpers/handlerZodError";
import { TErrorSources } from "../interfaces/error.types";

const swallowError = (_err: unknown): void => undefined;

export const globalErrorHandler = async (
  err: any,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  if (configs.node_env === "development") {
    logger.error(err);
  }

  // Delete any files uploaded to Cloudinary if the request failed
  if (req.file) {
    await deleteFromCloudinary(req.file.path).catch(swallowError);
  }

  if (req.files) {
    const files = Array.isArray(req.files)
      ? req.files
      : Object.values(req.files as Record<string, Express.Multer.File[]>).flat();

    await Promise.all(
      files.map((f) => deleteFromCloudinary(f.path).catch(swallowError)),
    );
  }

  let errorSources: TErrorSources[] = [];
  let statusCode = 500;
  let message = "Something went wrong!";

  if (err.code === 11000) {
    const simplified = handlerDuplicateError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
  } else if (err.name === "CastError") {
    const simplified = handleCastError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
  } else if (err.name === "ZodError") {
    const simplified = handlerZodError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
    errorSources = simplified.errorSources as TErrorSources[];
  } else if (err.name === "ValidationError") {
    const simplified = handlerValidationError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
    errorSources = simplified.errorSources as TErrorSources[];
  } else if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  }

  const response: Record<string, unknown> = { success: false, message, errorSources };
  if (configs.node_env === "development") {
    response.err = err;
    response.stack = err.stack;
  }
  res.status(statusCode).json(response);
};
