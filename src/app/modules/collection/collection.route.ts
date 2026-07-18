import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { CollectionControllers } from "./collection.controller";
import {
  addCollectionItemZodSchema,
  updateCollectionItemZodSchema,
} from "./collection.validation";

const router = Router();
const anyUser = Object.values(UserRole);

// NOTE: no plan gate here yet — whether Free gets collection access, and any
// size cap, is unresolved (docs/OPEN-QUESTIONS.md #5).

/**
 * @swagger
 * /collection:
 *   get:
 *     tags: [Collection]
 *     summary: List the caller's collection
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: searchTerm
 *         schema:
 *           type: string
 *         description: Matches card name
 *       - in: query
 *         name: set
 *         schema:
 *           type: string
 *       - in: query
 *         name: rarity
 *         schema:
 *           type: string
 *       - in: query
 *         name: minGrade
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxGrade
 *         schema:
 *           type: number
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: favorite
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [addedAt, price, grade, name]
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *     responses:
 *       200:
 *         description: Paginated collection entries with card and report joined
 *   post:
 *     tags: [Collection]
 *     summary: Add a card — scanned (via report) or manual (via card)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Added
 *       404:
 *         description: Card or report not found
 */
router.get("/", checkAuth(...anyUser), CollectionControllers.getMyCollection);

router.post(
  "/",
  checkAuth(...anyUser),
  validateRequest(addCollectionItemZodSchema),
  CollectionControllers.addItem,
);

/**
 * @swagger
 * /collection/summary:
 *   get:
 *     tags: [Collection]
 *     summary: Total value, card count, and average grade
 *     description: >
 *       Quantity-weighted. Average grade covers graded entries only — manual
 *       entries without a report are excluded rather than counted as zero.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary metrics
 */
router.get(
  "/summary",
  checkAuth(...anyUser),
  CollectionControllers.getSummary,
);

/**
 * @swagger
 * /collection/by-set:
 *   get:
 *     tags: [Collection]
 *     summary: Collection grouped by set/expansion
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Count and value per set
 */
router.get("/by-set", checkAuth(...anyUser), CollectionControllers.getBySet);

/**
 * @swagger
 * /collection/{id}:
 *   get:
 *     tags: [Collection]
 *     summary: Get one entry with its card and grading report
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
 *         description: Entry
 *       404:
 *         description: Not found, or not owned by the caller
 *   patch:
 *     tags: [Collection]
 *     summary: Update quantity, favourite flag, or external grade
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
 *         description: Updated
 *   delete:
 *     tags: [Collection]
 *     summary: Remove an entry
 *     description: >
 *       Removes the collection entry only. The grading report and its uploaded
 *       images are retained permanently as training data.
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
 *         description: Removed
 */
router.get("/:id", checkAuth(...anyUser), CollectionControllers.getSingleItem);

router.patch(
  "/:id",
  checkAuth(...anyUser),
  validateRequest(updateCollectionItemZodSchema),
  CollectionControllers.updateItem,
);

router.delete("/:id", checkAuth(...anyUser), CollectionControllers.removeItem);

export const CollectionRoutes = router;
