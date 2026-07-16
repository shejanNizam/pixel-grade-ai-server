import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserControllers } from "./user.controller";
import { UserRole } from "./user.interface";
import { createUserZodSchema, updateUserZodSchema } from "./user.validation";

const router = Router();

/**
 * @swagger
 * /user/register:
 *   post:
 *     tags: [User]
 *     summary: Register a new user account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       409:
 *         description: Email already in use
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
router.post(
  "/register",
  validateRequest(createUserZodSchema),
  UserControllers.createUser,
);

/**
 * @swagger
 * /user/all-users:
 *   get:
 *     tags: [User]
 *     summary: Get all users (admin/super_admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all users
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/all-users",
  checkAuth(UserRole.admin, UserRole.super_admin),
  UserControllers.getAllUsers,
);

/**
 * @swagger
 * /user/me:
 *   get:
 *     tags: [User]
 *     summary: Get the authenticated user's profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *   delete:
 *     tags: [User]
 *     summary: Soft-delete the authenticated user's own account
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account deleted
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/me",
  checkAuth(...Object.values(UserRole)),
  UserControllers.getMe,
);

router.delete(
  "/me",
  checkAuth(...Object.values(UserRole)),
  UserControllers.deleteMe,
);

/**
 * @swagger
 * /user/{id}:
 *   get:
 *     tags: [User]
 *     summary: Get a user by ID (admin/super_admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user
 *     responses:
 *       200:
 *         description: User found
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/User'
 *       404:
 *         description: User not found
 *   patch:
 *     tags: [User]
 *     summary: Update a user by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserRequest'
 *     responses:
 *       200:
 *         description: User updated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *   delete:
 *     tags: [User]
 *     summary: Delete a user by ID (admin/super_admin only)
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
 *         description: User deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.get(
  "/:id",
  checkAuth(UserRole.admin, UserRole.super_admin),
  UserControllers.getSingleUser,
);

router.patch(
  "/:id",
  checkAuth(...Object.values(UserRole)),
  validateRequest(updateUserZodSchema),
  UserControllers.updateUser,
);

router.delete(
  "/:id",
  checkAuth(UserRole.admin, UserRole.super_admin),
  UserControllers.deleteUser,
);

export const UserRoutes = router;
