import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { DeviceTokenControllers } from "./device_token.controller";

const router = Router();
const allRoles = Object.values(UserRole) as string[];

/**
 * @swagger
 * /device-token:
 *   post:
 *     tags: [Device Token]
 *     summary: Register or update a push notification device token
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceTokenRequest'
 *     responses:
 *       200:
 *         description: Device token saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *   delete:
 *     tags: [Device Token]
 *     summary: Remove the current device's push notification token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Device token removed
 *       401:
 *         description: Unauthorized
 */
router.post("/", checkAuth(...allRoles), DeviceTokenControllers.upsertToken);
router.delete("/", checkAuth(...allRoles), DeviceTokenControllers.removeToken);

export const DeviceTokenRoutes = router;
