import multer from "multer";
import { Router } from "express";
import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { multerUpload } from "../../config/multer.config";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { UploadControllers } from "./upload.controller";
import { logger } from "../../utils/logger";

const router = Router();
const allRoles = Object.values(UserRole) as string[];

/**
 * @swagger
 * /upload:
 *   post:
 *     tags: [Upload]
 *     summary: Upload one or more files to Cloudinary
 *     description: Send 1 file to get a single `{ url, publicId }` object back. Send 2–10 files to get an array.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 minItems: 1
 *                 maxItems: 10
 *                 description: Field name must be "files"
 *     responses:
 *       200:
 *         description: File(s) uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UploadResponse'
 *       400:
 *         description: No files provided
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/",
  checkAuth(...allRoles),
  (req, res, next) => {
    try {
      multerUpload.array("files", 10)(req, res, (err) => {
        if (err) {
          logger.error("Multer image upload error:", { error: err });
          if (err instanceof multer.MulterError) {
            if (err.code === "LIMIT_FILE_SIZE") {
              return next(
                new AppError(
                  httpStatus.BAD_REQUEST,
                  "File size exceeds the maximum limit (10MB).",
                ),
              );
            }
            if (err.code === "LIMIT_UNEXPECTED_FILE") {
              return next(
                new AppError(
                  httpStatus.BAD_REQUEST,
                  "Unexpected field or maximum 10 files allowed under field 'files'.",
                ),
              );
            }
            return next(
              new AppError(
                httpStatus.BAD_REQUEST,
                `Upload error: ${err.message}`,
              ),
            );
          }
          return next(
            new AppError(
              httpStatus.BAD_REQUEST,
              err.message || "File upload failed. Please check file size, format, and credentials.",
            ),
          );
        }
        next();
      });
    } catch (error) {
      next(error);
    }
  },
  UploadControllers.uploadFiles,
);

export const UploadRoutes = router;
