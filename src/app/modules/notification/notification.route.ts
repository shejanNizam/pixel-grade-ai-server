import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { NotificationControllers } from "./notification.controller";
import {
  broadcastNotificationZodSchema,
  updateNotificationSettingsZodSchema,
} from "./notification.validation";

const router = Router();
const anyUser = Object.values(UserRole);
const staffOnly = [UserRole.admin, UserRole.super_admin];

/**
 * @swagger
 * /notification:
 *   get:
 *     tags: [Notification]
 *     summary: Paginated notification history
 *     description: >
 *       Notifications are created server-side only from platform events — the
 *       one exception is POST /notification/broadcast, which is admin-guarded.
 *       New notifications are also pushed live over Socket.io as
 *       `notification:new`.
 *
 *       Scoped to the caller AND to one audience. `audience=user` (default)
 *       returns notifications about the caller's own activity; `audience=admin`
 *       returns platform-operations alerts and is refused for non-staff.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: audience
 *         schema:
 *           type: string
 *           enum: [user, admin]
 *           default: user
 *     responses:
 *       200:
 *         description: Notifications, newest first
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Non-staff requested the admin audience
 */
router.get("/", checkAuth(...anyUser), NotificationControllers.getMyNotifications);

/**
 * @swagger
 * /notification/broadcast:
 *   post:
 *     tags: [Notification]
 *     summary: Send an announcement to every active user (admin only)
 *     description: >
 *       Writes a `system` notification to every active customer. Type and
 *       audience are fixed server-side, so this cannot forge a grading or
 *       billing message, and cannot address the staff queue. `link` must be an
 *       in-app path.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string, maxLength: 120 }
 *               body: { type: string, maxLength: 500 }
 *               link: { type: string, example: "/user-dashboard/subscription" }
 *     responses:
 *       200:
 *         description: Delivery counts
 *       403:
 *         description: Not staff
 */
router.post(
  "/broadcast",
  checkAuth(...staffOnly),
  validateRequest(broadcastNotificationZodSchema),
  NotificationControllers.broadcast,
);

/**
 * @swagger
 * /notification/unread-count:
 *   get:
 *     tags: [Notification]
 *     summary: Unread badge count
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count
 */
router.get(
  "/unread-count",
  checkAuth(...anyUser),
  NotificationControllers.getUnreadCount,
);

/**
 * @swagger
 * /notification/settings:
 *   get:
 *     tags: [Notification]
 *     summary: Get delivery preferences
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings
 *   patch:
 *     tags: [Notification]
 *     summary: Update delivery preferences
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Settings updated
 */
router.get(
  "/settings",
  checkAuth(...anyUser),
  NotificationControllers.getSettings,
);

router.patch(
  "/settings",
  checkAuth(...anyUser),
  validateRequest(updateNotificationSettingsZodSchema),
  NotificationControllers.updateSettings,
);

/**
 * @swagger
 * /notification/read-all:
 *   patch:
 *     tags: [Notification]
 *     summary: Mark every notification as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All marked read
 */
router.patch(
  "/read-all",
  checkAuth(...anyUser),
  NotificationControllers.markAllAsRead,
);

/**
 * @swagger
 * /notification/{id}/read:
 *   patch:
 *     tags: [Notification]
 *     summary: Mark one notification as read
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
 *         description: Marked read
 *       404:
 *         description: Not found, or not owned by the caller
 */
router.patch(
  "/:id/read",
  checkAuth(...anyUser),
  NotificationControllers.markAsRead,
);

/**
 * @swagger
 * /notification/{id}:
 *   delete:
 *     tags: [Notification]
 *     summary: Delete a notification
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
 *         description: Deleted
 *       404:
 *         description: Not found, or not owned by the caller
 */
router.delete("/:id", checkAuth(...anyUser), NotificationControllers.remove);

export const NotificationRoutes = router;
