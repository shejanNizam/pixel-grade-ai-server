import { Response } from "express";
import { configs } from "../config/index";

export interface AuthTokens {
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Parses a JWT-style duration ("15m", "1d", "30d", "3600") into milliseconds.
 *
 * The cookie lifetime has to track the token lifetime. Hardcoding one while the
 * other comes from env drifts the moment someone tunes JWT_REFRESH_EXPIRES, and
 * the failure is silent: the cookie outlives the token (dead session that looks
 * live) or dies first (logged out while still holding a valid refresh token).
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export const durationToMs = (value: string, fallbackMs: number): number => {
  const match = /^(\d+)\s*([smhd])?$/i.exec(value.trim());
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return fallbackMs;

  const unit = (match[2] ?? "s").toLowerCase();
  return amount * (UNIT_MS[unit] ?? 1000);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Writes the auth cookies.
 *
 * Two things here are load-bearing and were both wrong in prototype V1:
 *
 * 1. `maxAge` MUST be set. Without it these are *session* cookies — the browser
 *    drops them when the window closes, so a user who quits the browser is
 *    logged out even though their 30-day refresh token is still perfectly
 *    valid. This was the "users are logged out frequently" report.
 *
 * 2. Cross-site delivery. When the API is on a different site than the app
 *    (api.example.com is same-site; a Vercel app calling a separate API domain
 *    is not), Chrome discards any cookie that is not `SameSite=None; Secure`.
 *    Production always sets both. `secure` cannot be enabled on plain-HTTP
 *    localhost, which is why development keeps `lax` — same-site localhost
 *    does not need `none` anyway.
 */
export const setAuthCookie = (res: Response, tokenInfo: AuthTokens) => {
  const isProduction = configs.node_env === "production";

  const baseOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
    path: "/",
  };

  if (tokenInfo.accessToken) {
    res.cookie("accessToken", tokenInfo.accessToken, {
      ...baseOptions,
      maxAge: durationToMs(configs.jwt_access_expires, DAY_MS),
    });
  }

  if (tokenInfo.refreshToken) {
    res.cookie("refreshToken", tokenInfo.refreshToken, {
      ...baseOptions,
      maxAge: durationToMs(configs.jwt_refresh_expires, 30 * DAY_MS),
    });
  }
};

/**
 * Clears the auth cookies.
 *
 * The attributes must match what `setAuthCookie` wrote — a `clearCookie` whose
 * sameSite/secure/path differ from the original is a no-op in every major
 * browser, which leaves a logged-out user still holding their tokens.
 */
export const clearAuthCookie = (res: Response) => {
  const isProduction = configs.node_env === "production";

  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
    path: "/",
  };

  res.clearCookie("accessToken", options);
  res.clearCookie("refreshToken", options);
};
