import { NextFunction, Request, Response, Router } from "express";
import passport from "passport";
import { configs } from "../../config/index";
import { checkAuth, checkResetToken } from "../../middlewares/checkAuth";
import { authLimiter } from "../../middlewares/rateLimiter";
import { UserRole } from "../user/user.interface";
import { AuthControllers } from "./auth.controller";

const router = Router();

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful — access token returned, refresh token set in cookie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Too many attempts
 */
router.post("/login", authLimiter, AuthControllers.credentialsLogin);

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Get a new access token using the refresh token cookie
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post("/refresh-token", authLimiter, AuthControllers.getNewAccessToken);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout and clear refresh token cookie
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", AuthControllers.logout);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password (requires current password)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChangePasswordRequest'
 *     responses:
 *       200:
 *         description: Password changed
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/change-password",
  authLimiter,
  checkAuth(...(Object.values(UserRole) as string[])),
  AuthControllers.changePassword,
);

/**
 * @swagger
 * /auth/set-password:
 *   post:
 *     tags: [Auth]
 *     summary: Set a password for OAuth accounts that have none
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SetPasswordRequest'
 *     responses:
 *       200:
 *         description: Password set
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/set-password",
  authLimiter,
  checkAuth(...(Object.values(UserRole) as string[])),
  AuthControllers.setPassword,
);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Send a password-reset email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ForgotPasswordRequest'
 *     responses:
 *       200:
 *         description: Reset email sent if account exists
 *       429:
 *         description: Too many attempts
 */
router.post("/forgot-password", authLimiter, AuthControllers.forgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using the token from the reset email
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPasswordRequest'
 *     responses:
 *       200:
 *         description: Password reset successful
 *       401:
 *         description: Invalid or expired reset token
 */
router.post(
  "/reset-password",
  authLimiter,
  checkResetToken,
  AuthControllers.resetPassword,
);

/**
 * @swagger
 * /auth/google:
 *   get:
 *     tags: [Auth]
 *     summary: Initiate Google OAuth login
 *     parameters:
 *       - in: query
 *         name: redirect
 *         schema:
 *           type: string
 *         description: URL to redirect to after successful login
 *     responses:
 *       302:
 *         description: Redirects to Google OAuth consent screen
 */
router.get(
  "/google",
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    const redirect = (req.query.redirect as string) || "/";

    passport.authenticate("google", {
      scope: ["profile", "email"],
      state: redirect,
    })(req, res, next);
  },
);

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     tags: [Auth]
 *     summary: Google OAuth callback (handled by Google, not called directly)
 *     responses:
 *       302:
 *         description: Redirects to frontend with access token
 */
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${configs.frontend_url}/login?error=There is some issues with your account. Please contact with out support team!`,
  }),
  AuthControllers.googleCallbackControll,
);

export const AuthRoutes = router;
