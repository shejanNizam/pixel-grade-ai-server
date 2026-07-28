import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import {
  requireCredits,
  requirePixelScope,
} from "../../middlewares/checkEntitlement";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { AnalysisControllers } from "./analysis.controller";
import {
  confirmCardZodSchema,
  createAnalysisZodSchema,
} from "./analysis.validation";

const router = Router();
const anyUser = Object.values(UserRole);

/**
 * @swagger
 * /analysis:
 *   post:
 *     tags: [Analysis]
 *     summary: Start a scan — upload images and identify the card
 *     description: >
 *       Costs 10 credits per finished report. The guard order is deliberate:
 *       authenticate, validate the body, check the PixelScope entitlement, then
 *       check the credit balance. The actual debit happens inside the service
 *       after the images are stored, and is refunded if identification fails,
 *       if the scan is canceled, or if it is left unconfirmed past the
 *       abandoned-scan timeout.
 *       Send a unique `clientRequestId` to make the call idempotent — a retry
 *       carrying the same key returns the original scan instead of charging
 *       again.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Scan started; status is `awaiting_confirmation`
 *       402:
 *         description: Not enough credits
 *       403:
 *         description: PixelScope requires the Collector plan or above
 *       503:
 *         description: Identification service is not configured
 *   get:
 *     tags: [Analysis]
 *     summary: List the caller's scans
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated scans
 */
router.post(
  "/",
  checkAuth(...anyUser),
  validateRequest(createAnalysisZodSchema),
  requirePixelScope,
  requireCredits,
  AnalysisControllers.createAnalysis,
);

router.get("/", checkAuth(...anyUser), AnalysisControllers.getMyAnalyses);

/**
 * @swagger
 * /analysis/{id}:
 *   get:
 *     tags: [Analysis]
 *     summary: Get a scan with its images and candidate matches
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
 *         description: Scan, images, and ranked candidates
 *       404:
 *         description: Not found, or not owned by the caller
 */
router.get("/:id", checkAuth(...anyUser), AnalysisControllers.getAnalysis);

/**
 * @swagger
 * /analysis/{id}/confirm:
 *   patch:
 *     tags: [Analysis]
 *     summary: Confirm which card the images actually show
 *     description: >
 *       The mandatory identification gate. Grading and slab generation refuse to
 *       run until this succeeds. The chosen card must be one of the candidates
 *       the system offered. Picking a card other than the suggested best match
 *       records `wasCorrected`, which is retained permanently as training data.
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
 *         description: Confirmed; status is `confirmed`
 *       400:
 *         description: Not awaiting confirmation, or card was not a candidate
 */
router.patch(
  "/:id/confirm",
  checkAuth(...anyUser),
  validateRequest(confirmCardZodSchema),
  AnalysisControllers.confirmCard,
);

/**
 * @swagger
 * /analysis/{id}/cancel:
 *   patch:
 *     tags: [Analysis]
 *     summary: Abandon a scan and get the credits back
 *     description: >
 *       Ends a scan that never became a report — typically the user closing the
 *       confirmation dialog without picking a card — and refunds its 10 credits.
 *       Idempotent: cancelling an already-ended scan succeeds without refunding
 *       twice. A graded scan cannot be canceled. Scans left unconfirmed are
 *       swept and refunded automatically after the timeout, so this endpoint is
 *       the fast path, not the only one.
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
 *         description: Canceled; credits returned
 *       400:
 *         description: Already graded
 *       404:
 *         description: Not found, or not owned by the caller
 */
router.patch(
  "/:id/cancel",
  checkAuth(...anyUser),
  AnalysisControllers.cancelAnalysis,
);

export const AnalysisRoutes = router;
