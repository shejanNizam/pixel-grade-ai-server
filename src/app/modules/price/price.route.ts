import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { requirePriceTracking } from "../../middlewares/checkEntitlement";
import { UserRole } from "../user/user.interface";
import { PriceControllers } from "./price.controller";

const router = Router();
const anyUser = Object.values(UserRole);

/**
 * @swagger
 * /price/portfolio:
 *   get:
 *     tags: [Price]
 *     summary: Total collection value and weighted change
 *     description: >
 *       Collector plan and above. Change percentages are value-weighted, not a
 *       plain mean — a large move on a high-value card outweighs the same move
 *       on a common.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Portfolio totals
 *       403:
 *         description: Price tracking requires the Collector plan or above
 */
router.get(
  "/portfolio",
  checkAuth(...anyUser),
  requirePriceTracking,
  PriceControllers.getPortfolioSummary,
);

/**
 * @swagger
 * /price/refresh:
 *   post:
 *     tags: [Price]
 *     summary: Trigger a price sweep immediately (admin only)
 *     description: >
 *       Same work the hourly cron does. Sweeps oldest-priced cards first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Counts of refreshed and failed cards
 *       403:
 *         description: Forbidden — insufficient role
 */
router.post(
  "/refresh",
  checkAuth(UserRole.admin, UserRole.super_admin),
  PriceControllers.refreshNow,
);

/**
 * @swagger
 * /price/history:
 *   get:
 *     tags: [Price]
 *     summary: Downsampled price history for many cards at once
 *     description: >
 *       Backs the price tracker's per-row sparklines, which would otherwise
 *       need one request per visible card. Points are bucketed (daily for 7d
 *       and 30d, monthly for 1y, raw for 24h) and each bucket carries its
 *       closing price. Cards with no history yet come back as an empty array
 *       rather than being omitted.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cardIds
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated card ids, capped at 50
 *       - in: query
 *         name: window
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d, 1y]
 *     responses:
 *       200:
 *         description: Map of card id to points, oldest-first
 *       403:
 *         description: Price tracking requires the Collector plan or above
 */
// Must stay above `/:cardId` — otherwise the param route claims "history".
router.get(
  "/history",
  checkAuth(...anyUser),
  requirePriceTracking,
  PriceControllers.getHistoryBatch,
);

/**
 * @swagger
 * /price/{cardId}:
 *   get:
 *     tags: [Price]
 *     summary: Price history for one card
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cardId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: window
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d, 1y]
 *     responses:
 *       200:
 *         description: Points oldest-first, plus the change over the window
 *       403:
 *         description: Price tracking requires the Collector plan or above
 *       404:
 *         description: Card not found
 */
router.get(
  "/:cardId",
  checkAuth(...anyUser),
  requirePriceTracking,
  PriceControllers.getCardPrice,
);

export const PriceRoutes = router;
