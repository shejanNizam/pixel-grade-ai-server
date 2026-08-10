import httpStatus from "http-status";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Bot protection — Cloudflare Turnstile.
//
// Added for support ticket submission (client, 2026-08-10). Turnstile rather
// than reCAPTCHA: no per-request cost, no Google account required, and it does
// not need a visible puzzle in the common case.
//
// ⚠️ FAIL-OPEN WHEN UNCONFIGURED, FAIL-CLOSED WHEN CONFIGURED.
//
// Without a secret key, `verifyCaptcha` returns without checking anything and
// the server warns at startup. That is deliberate — the keys are the client's
// to provision, and hard-failing would take the whole support form down in
// every environment until they arrive. It also means **an unset
// TURNSTILE_SECRET_KEY in production silently disables spam protection**, so
// setting it is a deployment requirement, not a nice-to-have.
//
// Once the secret IS set, a missing or invalid token is rejected outright —
// including when Cloudflare itself is unreachable. A captcha that waves
// requests through whenever the verifier is down protects nothing.
// ---------------------------------------------------------------------------

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** How long to wait on Cloudflare before giving up on the request. */
const VERIFY_TIMEOUT_MS = 5_000;

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
}

/** Warned once at boot so a misconfigured deploy is visible in the logs. */
export const warnIfCaptchaDisabled = () => {
  if (!configs.CAPTCHA.enabled) {
    logger.warn(
      "TURNSTILE_SECRET_KEY is not set — captcha verification is DISABLED. " +
        "Support ticket submission is unprotected against automated spam.",
    );
  }
};

/**
 * Throws unless `token` is a valid Turnstile solution.
 *
 * @param token  The `cf-turnstile-response` the widget produced client-side.
 * @param remoteIp  The submitter's IP, if known. Optional but tightens the check.
 */
export const verifyCaptcha = async (
  token: string | undefined,
  remoteIp?: string,
): Promise<void> => {
  if (!configs.CAPTCHA.enabled) return;

  if (!token) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Please complete the verification challenge before submitting.",
    );
  }

  const body = new URLSearchParams({
    secret: configs.CAPTCHA.turnstile_secret as string,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  let result: TurnstileResponse;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    result = (await response.json()) as TurnstileResponse;
  } catch (error) {
    logger.error("Turnstile verification request failed", { error });
    // Fail closed: see the header note.
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Couldn't complete the verification check. Please try again in a moment.",
    );
  }

  if (!result.success) {
    logger.warn("Turnstile rejected a submission", {
      errors: result["error-codes"],
    });
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Verification failed. Please try the challenge again.",
    );
  }
};

export const CaptchaProvider = { verifyCaptcha, warnIfCaptchaDisabled };
