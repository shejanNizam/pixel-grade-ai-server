import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { CardControllers } from "./card.controller";

const router = Router();

/**
 * @swagger
 * /card:
 *   get:
 *     tags: [Card]
 *     summary: Search the card catalogue
 *     description: >
 *       Read-only. Catalogue rows are written by the identification pipeline —
 *       there is no create, update, or delete endpoint.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: searchTerm
 *         schema:
 *           type: string
 *         description: Matches name, set/expansion, or card number
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Paginated cards
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  checkAuth(...Object.values(UserRole)),
  CardControllers.getAllCards,
);

/**
 * @swagger
 * /card/sets:
 *   get:
 *     tags: [Card]
 *     summary: Distinct set/expansion names, for collection filters
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Set names
 */
router.get(
  "/sets",
  checkAuth(...Object.values(UserRole)),
  CardControllers.getSets,
);

/**
 * @swagger
 * /card/{id}:
 *   get:
 *     tags: [Card]
 *     summary: Get a single card
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
 *         description: Card found
 *       404:
 *         description: Card not found
 */
router.get(
  "/:id",
  checkAuth(...Object.values(UserRole)),
  CardControllers.getSingleCard,
);

export const CardRoutes = router;
