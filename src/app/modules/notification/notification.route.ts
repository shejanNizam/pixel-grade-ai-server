import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { NotificationControllers } from "./notification.controller";
import { updateNotificationSettingsZodSchema } from "./notification.validation";

const router = Router();
const anyUser = Object.values(UserRole);

/**
 * @swagger
 * /notification:
 *   get:
 *     tags: [Notification]
 *     summary: Paginated notification history
 *     description: >
 *       Notifications are created server-side only — there is no POST endpoint.
 *       New notifications are also pushed live over Socket.io as
 *       `notification:new`.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notifications, newest first
 *       401:
 *         description: Unauthorized
 */
router.get("/", checkAuth(...anyUser), NotificationControllers.getMyNotifications);

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
