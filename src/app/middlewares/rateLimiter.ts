import rateLimit from "express-rate-limit";

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});

// For login, refresh-token, logout, change/set/reset-password, google auth
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many auth attempts, please try again later." },
});

/**
 * For the public slab-verification lookup.
 *
 * Unauthenticated and matched by a *suffix* scan, so it is both the cheapest
 * endpoint to hammer and the most expensive to serve. Generous enough that a
 * collector scanning a stack of slabs never trips it.
 */
export const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification requests, please try again later.",
  },
});

// For OTP send — very tight to prevent abuse
export const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "OTP request limit reached, please try again in an hour." },
});
