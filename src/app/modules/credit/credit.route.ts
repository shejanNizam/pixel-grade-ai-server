import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { CreditControllers } from "./credit.controller";
import { adminAdjustCreditsZodSchema } from "./credit.validation";

const router = Router();

/**
 * @swagger
 * /credit/me:
 *   get:
 *     tags: [Credit]
 *     summary: Get the authenticated user's credit balance
 *     description: >
 *       Returns balance, whether the plan is unlimited, the cost per scan, and
 *       how many scans the balance buys. `balance` is null on unlimited plans.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Credit balance
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/me",
  checkAuth(...Object.values(UserRole)),
  CreditControllers.getMyBalance,
);

/**
 * @swagger
 * /credit/me/ledger:
 *   get:
 *     tags: [Credit]
 *     summary: Paginated history of the user's credit grants and spends
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Ledger entries, newest first
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/me/ledger",
  checkAuth(...Object.values(UserRole)),
  CreditControllers.getMyLedger,
);

/**
 * @swagger
 * /credit/{userId}/ledger:
 *   get:
 *     tags: [Credit]
 *     summary: Any user's credit ledger (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ledger entries
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/:userId/ledger",
  checkAuth(UserRole.admin, UserRole.super_admin),
  CreditControllers.getUserLedger,
);

/**
 * @swagger
 * /credit/{userId}/adjust:
 *   post:
 *     tags: [Credit]
 *     summary: Manually add or remove credits (admin only)
 *     description: >
 *       Additive, not a reset. Writes a ledger row recording which admin made
 *       the change. A negative adjustment larger than the balance clamps to
 *       zero rather than going negative.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Adjusted; returns the new balance
 *       403:
 *         description: Forbidden — insufficient role
 */
router.post(
  "/:userId/adjust",
  checkAuth(UserRole.admin, UserRole.super_admin),
  validateRequest(adminAdjustCreditsZodSchema),
  CreditControllers.adminAdjust,
);

export const CreditRoutes = router;
