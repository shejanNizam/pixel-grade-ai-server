import { Router } from "express";
import { otpLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { OTPController } from "./otp.controller";
import { sendOtpZodSchema, verifyOtpZodSchema } from "./otp.validation";

const router = Router();

/**
 * @swagger
 * /otp/send:
 *   post:
 *     tags: [OTP]
 *     summary: Send a 6-digit OTP to the given email address
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SendOtpRequest'
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       429:
 *         description: OTP send limit reached (5 per hour per IP)
 */
router.post("/send", otpLimiter, validateRequest(sendOtpZodSchema), OTPController.sendOTP);

/**
 * @swagger
 * /otp/verify:
 *   post:
 *     tags: [OTP]
 *     summary: Verify a 6-digit OTP for the given email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyOtpRequest'
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid or expired OTP
 *       422:
 *         description: Validation error
 */
router.post("/verify", validateRequest(verifyOtpZodSchema), OTPController.verifyOTP);

export const OtpRoutes = router;
