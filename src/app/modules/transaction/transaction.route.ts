import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { TransactionControllers } from "./transaction.controller";

const router = Router();
const anyUser = Object.values(UserRole);
const adminOnly = [UserRole.admin, UserRole.super_admin] as const;

/**
 * @swagger
 * /transaction/me:
 *   get:
 *     tags: [Transaction]
 *     summary: The caller's billing history and invoices
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated transactions, newest first
 */
router.get(
  "/me",
  checkAuth(...anyUser),
  TransactionControllers.getMyTransactions,
);

/**
 * @swagger
 * /transaction/earnings:
 *   get:
 *     tags: [Transaction]
 *     summary: Platform earnings overview (admin only)
 *     description: >
 *       Counts succeeded transactions only. Refunds are reported separately
 *       rather than netted off, so gross and refunded are both visible.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Revenue split by subscriptions and slab orders
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/earnings",
  checkAuth(...adminOnly),
  TransactionControllers.getEarnings,
);

/**
 * @swagger
 * /transaction/revenue-by-month:
 *   get:
 *     tags: [Transaction]
 *     summary: Monthly revenue buckets for the earnings chart (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: months
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Revenue per month
 */
router.get(
  "/revenue-by-month",
  checkAuth(...adminOnly),
  TransactionControllers.getRevenueByMonth,
);

/**
 * @swagger
 * /transaction:
 *   get:
 *     tags: [Transaction]
 *     summary: All transactions (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated transactions
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/",
  checkAuth(...adminOnly),
  TransactionControllers.getAllTransactions,
);

export const TransactionRoutes = router;
