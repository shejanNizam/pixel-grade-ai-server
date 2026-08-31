/* eslint-disable @typescript-eslint/no-unused-vars */
import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
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

export interface IGlobalError extends Error {
  code?: number;
  statusCode?: number;
  errorSources?: TErrorSources[];
}

export const globalErrorHandler = async (
  err: IGlobalError,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  if (configs.node_env === "development") {
    logger.error(err);
  }

  // Delete any files uploaded to Cloudinary if the request failed
  try {
    if (req.file?.path) {
      await deleteFromCloudinary(req.file.path).catch(swallowError);
    }

    if (req.files) {
      const files = Array.isArray(req.files)
        ? req.files
        : Object.values(req.files as Record<string, Express.Multer.File[]>).flat();

      const validFiles = files.filter(
        (f): f is Express.Multer.File => Boolean(f && typeof f.path === "string" && f.path.trim().length > 0),
      );

      await Promise.all(
        validFiles.map((f) => deleteFromCloudinary(f.path).catch(swallowError)),
      );
    }
  } catch (cleanupErr) {
    logger.error("Error during Cloudinary file cleanup in globalErrorHandler:", cleanupErr);
  }

  let errorSources: TErrorSources[] = [];
  let statusCode = 500;
  let message = "Something went wrong!";

  if (err.code === 11000) {
    const simplified = handlerDuplicateError(err);
    statusCode = simplified.statusCode;
    message = simplified.message;
  } else if (err.name === "CastError") {
    const simplified = handleCastError(err as unknown as mongoose.Error.CastError);
    statusCode = simplified.statusCode;
    message = simplified.message;
  } else if (err.name === "ZodError") {
    const simplified = handlerZodError(err as unknown as z.ZodError);
    statusCode = simplified.statusCode;
    message = simplified.message;
    errorSources = simplified.errorSources as TErrorSources[];
  } else if (err.name === "ValidationError") {
    const simplified = handlerValidationError(err as unknown as mongoose.Error.ValidationError);
    statusCode = simplified.statusCode;
    message = simplified.message;
    errorSources = simplified.errorSources as TErrorSources[];
  } else if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  }

  // Prevent security leaks of secret API keys (e.g. Stripe sk_live_/sk_test_) in public API responses
  if (
    message.includes("sk_live_") ||
    message.includes("sk_test_") ||
    err.name === "StripeAuthenticationError" ||
    err.name === "StripeAPIError"
  ) {
    logger.error("Stripe Payment Gateway Error:", err);
    message = "Payment gateway is currently misconfigured. Please contact support.";
  }

  const response: Record<string, unknown> = { success: false, message, errorSources };
  if (configs.node_env === "development") {
    response.err = err;
    response.stack = err.stack;
  }
  res.status(statusCode).json(response);
};

