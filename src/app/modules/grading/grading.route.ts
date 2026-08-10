import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { verifyLimiter } from "../../middlewares/rateLimiter";
import { UserRole } from "../user/user.interface";
import { GradingControllers } from "./grading.controller";

const router = Router();
const anyUser = Object.values(UserRole);

/**
 * @swagger
 * /grading/all:
 *   get:
 *     tags: [Grading]
 *     summary: Every grading report (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated reports
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/all",
  checkAuth(UserRole.admin, UserRole.super_admin),
  GradingControllers.getAllReports,
);

/**
 * @swagger
 * /grading:
 *   get:
 *     tags: [Grading]
 *     summary: The caller's grading reports
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated reports
 */
router.get("/", checkAuth(...anyUser), GradingControllers.getMyReports);

/**
 * @swagger
 * /grading/{analysisId}:
 *   post:
 *     tags: [Grading]
 *     summary: Grade a confirmed scan
 *     description: >
 *       Requires the scan to be confirmed — an unconfirmed analysis is rejected.
 *       Results are cached by image-set hash and model version, which is what
 *       makes grading repeatable: identical images always replay the same
 *       scores rather than re-running a non-deterministic model. Costs no
 *       additional credits; the scan was already charged.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: analysisId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Report generated
 *       400:
 *         description: Scan not confirmed, or has no images
 *       503:
 *         description: Grading service is not configured
 */
router.post(
  "/:analysisId",
  checkAuth(...anyUser),
  GradingControllers.gradeAnalysis,
);

/**
 * @swagger
 * /grading/report/{id}:
 *   get:
 *     tags: [Grading]
 *     summary: Get one grading report
 *     description: Users may read their own reports; admins may read any.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Report
 *       403:
 *         description: Not your report
 *       404:
 *         description: Report not found
 */
router.get(
  "/report/:id",
  checkAuth(...anyUser),
  GradingControllers.getReport,
);

/**
 * @swagger
 * /grading/report/{id}/pdf:
 *   get:
 *     tags: [Grading]
 *     summary: Download the report as a PDF
 *     description: >
 *       Returns application/pdf bytes, not JSON. Watermarked when the report
 *       OWNER's plan has watermarkReports (Free by default) — rendered fresh
 *       per download so the watermark always reflects the current plan.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: PDF file
 *       403:
 *         description: Not your report
 *       404:
 *         description: Report not found
 */
router.get(
  "/report/:id/pdf",
  checkAuth(...anyUser),
  GradingControllers.downloadReportPdf,
);

/**
 * @swagger
 * /grading/verify/{pixelId}:
 *   get:
 *     tags: [Grading]
 *     summary: Public slab verification (no auth)
 *     description: >
 *       Resolves the PIXEL ID printed on a slab band to a read-only summary of
 *       the grade. This is the target of the QR code on every slab, so it is
 *       deliberately unauthenticated — anyone holding the physical card can
 *       confirm the grade is genuine.
 *
 *       Returns a fixed public projection only: card details, the four
 *       sub-scores, the grade, the owner's public handle and avatar. Never the
 *       raw model output, the reasoning, or the owner's email.
 *     parameters:
 *       - in: path
 *         name: pixelId
 *         required: true
 *         description: With or without the `PG-` prefix, any case.
 *         schema:
 *           type: string
 *           example: PG-A1B2C3D4E5
 *     responses:
 *       200:
 *         description: The public grade summary
 *       400:
 *         description: Malformed Pixel ID
 *       404:
 *         description: No graded card matches that Pixel ID
 *       429:
 *         description: Rate limited
 */
router.get(
  "/verify/:pixelId",
  verifyLimiter,
  GradingControllers.verifyPixelId,
);

export const GradingRoutes = router;
