import { Router } from "express";
import { multerUpload } from "../../config/multer.config";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { UploadControllers } from "./upload.controller";

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
  multerUpload.array("files", 10),
  UploadControllers.uploadFiles,
);

export const UploadRoutes = router;
