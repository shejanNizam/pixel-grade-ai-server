import crypto from "crypto";
import { redisClient } from "../../config/redis.config";
import AppError from "../../errorHelpers/AppError";
import { sendEmail } from "../../utils/sendEmail";
import { User } from "../user/user.model";

const OTP_EXPIRATION = 2 * 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_WINDOW = 10 * 60;

const generateOtp = (length = 6) => {
  const otp = crypto.randomInt(10 ** (length - 1), 10 ** length);
  return otp;
};

const sendOTP = async (email: string) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError(404, "User not found");
  }

  if (user.isEmailVerified) {
    throw new AppError(401, "You are already verified");
  }
  const otp = generateOtp();

  const redisKey = `otp:${email}`;
  const attemptsKey = `otp:attempts:${email}`;

  await Promise.all([
    redisClient.set(redisKey, String(otp), {
      expiration: { type: "EX", value: OTP_EXPIRATION },
    }),
    redisClient.del([attemptsKey]),
  ]);

  await sendEmail({
    to: email,
    subject: "Your OTP Code",
    templateName: "otp",
    templateData: { name: user.name, otp },
  });
};

const verifyOTP = async (email: string, otp: string) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError(404, "User not found");
  }

  if (user.isEmailVerified) {
    throw new AppError(401, "You are already verified");
  }

  const redisKey = `otp:${email}`;
  const attemptsKey = `otp:attempts:${email}`;

  const attempts = await redisClient.get(attemptsKey);
  if (Number(attempts) >= OTP_MAX_ATTEMPTS) {
    throw new AppError(429, "Too many failed attempts. Please request a new OTP.");
  }

  const savedOtp = await redisClient.get(redisKey);
  if (!savedOtp) {
    throw new AppError(401, "OTP expired or not found. Please request a new one.");
  }

  if (savedOtp !== otp) {
    const newAttempts = await redisClient.incr(attemptsKey);
    if (newAttempts === 1) {
      await redisClient.expire(attemptsKey, OTP_LOCKOUT_WINDOW);
    }
    const remaining = OTP_MAX_ATTEMPTS - newAttempts;
    const msg =
      remaining > 0
        ? `Invalid OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
        : "Too many failed attempts. Please request a new OTP.";
    throw new AppError(401, msg);
  }

  await Promise.all([
    User.updateOne({ email }, { isEmailVerified: true }, { runValidators: true }),
    redisClient.del([redisKey]),
    redisClient.del([attemptsKey]),
  ]);
};

export const OTPService = {
  sendOTP,
  verifyOTP,
};
