import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { DashboardControllers } from "./dashboard.controller";

const router = Router();
const anyUser = Object.values(UserRole);

/**
 * @swagger
 * /dashboard/me:
 *   get:
 *     tags: [Dashboard]
 *     summary: Stat cards for the user dashboard landing page
 *     description: >
 *       Collection value, cards held, slabs ordered, scans run, and average
 *       grade — each with a month-over-month delta. A delta is null when the
 *       previous month was zero, since growth from nothing has no percentage;
 *       render no chip rather than substituting a number. Average grade is null
 *       outright for a collection with nothing graded in it.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Five stat cards
 */
router.get("/me", checkAuth(...anyUser), DashboardControllers.getUserOverview);

/**
 * @swagger
 * /dashboard/admin:
 *   get:
 *     tags: [Dashboard]
 *     summary: Stat cards for the admin dashboard landing page (admin only)
 *     description: >
 *       Total users, active subscribers, new subscribers this month, lifetime
 *       earnings, and MRR. The subscriber delta is approximate — see the
 *       service for why churn is invisible to it.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Four stat cards plus MRR
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/admin",
  checkAuth(UserRole.admin, UserRole.super_admin),
  DashboardControllers.getAdminOverview,
);

export const DashboardRoutes = router;
