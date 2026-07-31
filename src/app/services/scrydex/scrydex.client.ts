import httpStatus from "http-status";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { logger } from "../../utils/logger";
import type { ScrydexUsageResponse } from "./scrydex.types";

/**
 * The one place that talks to api.scrydex.com.
 *
 * Identification (Vision), pricing, and price history all go through `request`,
 * so authentication, timeouts, error mapping, and credit accounting are written
 * once. Adding a Scrydex endpoint should never mean re-deriving the header
 * names or re-deciding which HTTP status means "refund the scan".
 *
 * AUTH: both `X-Api-Key` and `X-Team-ID` are required. Either alone returns
 * 401, and Scrydex will happily serve unauthenticated requests at a crippled
 * rate limit rather than rejecting them — so a dropped header shows up as
 * mysterious throttling, not as an obvious auth error.
 *
 * CREDITS: every call costs 1 credit except Vision, which costs 5. Failed
 * Vision calls still bill (observed 2026-07-31: a 401 from Vision consumed 5).
 * The client's account is on the **Starter** tier — 5,000 credits/month — so
 * that arithmetic is not academic. See `docs/THIRD-PARTY-COSTS.md`.
 */

/** Credit cost per call, for the debug log. Vision is the only exception. */
export const SCRYDEX_CREDIT_COST = { standard: 1, vision: 5 } as const;

/** Beyond this a scan feels broken to the user; Vision itself answers in 1–3s. */
const REQUEST_TIMEOUT_MS = 20_000;

export interface ScrydexRequestOptions {
  method?: "GET" | "POST";
  /** Appended as a query string. Undefined values are dropped, not sent empty. */
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Vision costs 5 credits; everything else costs 1. Logging only. */
  vision?: boolean;
  /** What the user was doing, used in error messages and logs. */
  operation: string;
}

export const isConfigured = (): boolean =>
  Boolean(configs.SCRYDEX.api_key && configs.SCRYDEX.team_id);

/**
 * Both credentials or neither.
 *
 * Half-configured is the worst state: Scrydex answers a keyless request instead
 * of rejecting it, so a missing team id would look like intermittent rate
 * limiting rather than a config mistake.
 */
const requireCredentials = (operation: string) => {
  if (isConfigured()) return;

  throw new AppError(
    httpStatus.SERVICE_UNAVAILABLE,
    `${operation} is unavailable — SCRYDEX_API_KEY and SCRYDEX_TEAM_ID must both be set.`,
  );
};

const buildUrl = (
  path: string,
  query?: ScrydexRequestOptions["query"],
): string => {
  const url = new URL(
    path.startsWith("/") ? path : `/${path}`,
    configs.SCRYDEX.base_url,
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
};

/**
 * Maps a Scrydex failure onto an AppError whose status says what the caller
 * should do about it.
 *
 * The distinction that matters: 401/403 and 5xx are *our* problem (bad key,
 * vendor down) and must surface as 503/502 so the scan pipeline refunds the
 * user's credits. A 404 on a card id is a genuine miss and stays a 404.
 */
const toAppError = (
  operation: string,
  status: number,
  body: string,
): AppError => {
  const detail = body.slice(0, 300);

  if (status === 401 || status === 403) {
    // Scrydex uses 401 for BOTH "bad credentials" and "your plan does not
    // include this endpoint". Vision on a plan without Vision access returns
    // `{"error":"You do not have access to this endpoint"}` — identical status,
    // completely different fix, so the body is the only way to tell them apart
    // and it belongs in the message.
    return new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      `${operation} was rejected by Scrydex (${status}). Check that SCRYDEX_API_KEY and SCRYDEX_TEAM_ID are correct and that the plan includes this endpoint. Vendor said: ${detail}`,
    );
  }

  if (status === 404) {
    return new AppError(httpStatus.NOT_FOUND, `${operation}: not found.`);
  }

  if (status === 429) {
    return new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      `${operation} was rate limited by Scrydex. Retry shortly.`,
    );
  }

  return new AppError(
    httpStatus.BAD_GATEWAY,
    `${operation} failed — Scrydex returned ${status}: ${detail}`,
  );
};

/**
 * Issues one authenticated Scrydex request.
 *
 * Deliberately does NOT retry. Every call costs credits from a 5,000/month
 * pool, and a blind retry on a Vision timeout spends another 5 on a request
 * that may well have succeeded server-side. Callers that can tolerate a miss
 * (the price sweep) skip the card instead.
 */
export const request = async <T>(
  path: string,
  options: ScrydexRequestOptions,
): Promise<T> => {
  const { method = "GET", query, body, vision = false, operation } = options;

  requireCredentials(operation);

  const url = buildUrl(path, query);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "X-Api-Key": configs.SCRYDEX.api_key as string,
        "X-Team-ID": configs.SCRYDEX.team_id as string,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Network or timeout. 502 so the scan pipeline treats it as a vendor
    // failure and refunds, rather than blaming the user's images.
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      `${operation} could not reach Scrydex: ${(error as Error).message}`,
    );
  }

  const cost = vision ? SCRYDEX_CREDIT_COST.vision : SCRYDEX_CREDIT_COST.standard;

  logger.debug("Scrydex request", {
    operation,
    status: response.status,
    ms: Date.now() - startedAt,
    // A failed Vision call is still billed, so this is logged regardless of
    // outcome — the credit is spent either way.
    creditCost: cost,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw toAppError(operation, response.status, text);
  }

  return (await response.json()) as T;
};

/**
 * Remaining credits for the billing period.
 *
 * Free to call (the usage endpoint does not itself consume credits) and the
 * only way to see an overrun coming: Scrydex does not cut you off at the
 * allowance, it silently rolls into billed overage at $0.006/credit on Starter.
 */
export const getUsage = async () => {
  const payload = await request<ScrydexUsageResponse>("/account/v1/usage", {
    operation: "Scrydex usage lookup",
  });

  const data = payload.data ?? {};

  return {
    creditsConsumed: data.total_credits_consumed ?? 0,
    overageConsumed: data.overage_credits_consumed ?? 0,
    creditsRemaining: data.credits_remaining ?? 0,
    periodStart: data.period_start ? new Date(data.period_start) : undefined,
    periodEnd: data.period_end ? new Date(data.period_end) : undefined,
    dailyUsage: (data.daily_usage ?? []).map((day) => ({
      date: day.date ?? "",
      creditsConsumed: day.credits_consumed ?? 0,
    })),
  };
};

export type ScrydexUsage = Awaited<ReturnType<typeof getUsage>>;

export const ScrydexClient = {
  request,
  getUsage,
  isConfigured,
};
