import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { ActivityLogControllers } from "./activity_log.controller";

const router = Router();

/**
 * @swagger
 * /activity-log:
 *   get:
 *     tags: [ActivityLog]
 *     summary: Read the audit trail (admin only)
 *     description: >
 *       Filter with any log field, e.g. `?action=login_failed`. There is no
 *       write endpoint — logs are recorded server-side by the modules that
 *       perform the actions.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
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
 *         description: Paginated log entries, newest first
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/",
  checkAuth(UserRole.admin, UserRole.super_admin),
  ActivityLogControllers.getAllLogs,
);

export const ActivityLogRoutes = router;
