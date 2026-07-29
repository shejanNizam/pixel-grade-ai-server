import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { SlabControllers } from "./slab.controller";
import {
  createSlabLabelZodSchema,
  regenerateSlabZodSchema,
  selectSlabVariantZodSchema,
} from "./slab.validation";

const router = Router();
const anyUser = Object.values(UserRole);

// GET /slab/styles is gone (2026-07-30). Background artwork is no longer picked
// from a fixed theme list — it is generated from the confirmed card as four
// EXT. ART options, so there is nothing to enumerate.

/**
 * @swagger
 * /slab:
 *   post:
 *     tags: [Slab]
 *     summary: Generate a slab label for a grading report
 *     description: >
 *       Only the background is AI-generated. The card image and label text are
 *       composited server-side at fixed coordinates, so the template cannot
 *       break. Exports a 300 DPI PNG and a PDF sized in millimetres.
 *       Dimensions are server-owned and cannot be set by the client.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Label generated with PNG and PDF export URLs
 *       404:
 *         description: Grading report not found, or not owned by the caller
 *       503:
 *         description: Background generation is not configured
 *   get:
 *     tags: [Slab]
 *     summary: List the caller's slab labels
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated labels
 */
router.post(
  "/",
  checkAuth(...anyUser),
  validateRequest(createSlabLabelZodSchema),
  SlabControllers.createLabel,
);

router.get("/", checkAuth(...anyUser), SlabControllers.getMyLabels);

/**
 * @swagger
 * /slab/{id}:
 *   get:
 *     tags: [Slab]
 *     summary: Get one slab label
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
 *         description: Label
 *       404:
 *         description: Not found, or not owned by the caller
 */
router.get("/:id", checkAuth(...anyUser), SlabControllers.getLabel);

/**
 * @swagger
 * /slab/{id}/regenerate:
 *   post:
 *     tags: [Slab]
 *     summary: Generate four completely new EXT. ART options
 *     description: >
 *       Discards the current four options and generates a fresh set from the
 *       confirmed card. Replaces only the artwork — the card image, label text,
 *       and geometry are unchanged. Increments the label version.
 *
 *       COST: four billed image generations per call.
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
 *         description: Four new options, with the first selected
 */
router.post(
  "/:id/regenerate",
  checkAuth(...anyUser),
  validateRequest(regenerateSlabZodSchema),
  SlabControllers.regenerate,
);

/**
 * @swagger
 * /slab/{id}/variant:
 *   patch:
 *     tags: [Slab]
 *     summary: Choose which EXT. ART option the slab uses
 *     description: >
 *       Points the label's exports at one of the already-generated options.
 *       Costs nothing at the image provider — every option was composited when
 *       the batch was generated, so this only rebuilds the PDF.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [variantIndex]
 *             properties:
 *               variantIndex:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 4
 *                 description: 1-based, matching the "EXT. ART n" label
 *     responses:
 *       200:
 *         description: Label now exports the selected artwork
 */
router.patch(
  "/:id/variant",
  checkAuth(...anyUser),
  validateRequest(selectSlabVariantZodSchema),
  SlabControllers.selectVariant,
);

/**
 * @swagger
 * /slab/{id}/preview:
 *   get:
 *     tags: [Slab]
 *     summary: Preview PNG with bleed, trim, and safe-area guides
 *     description: >
 *       Returns image/png directly. Guides are for on-screen checking only and
 *       never appear in an export.
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
 *         description: PNG with guides
 *         content:
 *           image/png: {}
 *       400:
 *         description: Label has no background yet
 */
router.get("/:id/preview", checkAuth(...anyUser), SlabControllers.preview);

export const SlabRoutes = router;
