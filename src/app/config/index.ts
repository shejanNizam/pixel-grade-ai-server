import dotenv from "dotenv";
import path from "path";
import { z } from "zod";
import { SLAB_CARD_RENDER_MODES } from "../constants";

dotenv.config({ path: path.join(process.cwd(), ".env") });


const envSchema = z.object({
  PORT: z.string().default("5000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  JWT_ACCESS_SECRET: z.string().min(8, "JWT_ACCESS_SECRET must be at least 8 characters"),
  JWT_ACCESS_EXPIRES: z.string().default("1d"),
  JWT_REFRESH_SECRET: z.string().min(8, "JWT_REFRESH_SECRET must be at least 8 characters"),
  JWT_REFRESH_EXPIRES: z.string().default("30d"),
  JWT_RESET_SECRET: z.string().min(8, "JWT_RESET_SECRET must be at least 8 characters"),

  BCRYPT_SALT_ROUND: z.string().default("10"),

  SUPER_ADMIN_EMAIL: z.string().email("SUPER_ADMIN_EMAIL must be a valid email"),
  SUPER_ADMIN_PASSWORD: z.string().min(8, "SUPER_ADMIN_PASSWORD must be at least 8 characters"),
  ADMIN_EMAIL: z.string().email("ADMIN_EMAIL must be a valid email"),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),

  EXPRESS_SESSION_SECRET: z.string().min(1, "EXPRESS_SESSION_SECRET is required"),

  FRONTEND_URL: z.string().default("*"),
  /** The single canonical frontend URL for redirects, emails, OAuth returns,
   *  and Stripe success/cancel pages. Independent of the CORS list so dev can
   *  keep localhost first in FRONTEND_URL while links still point at the live
   *  site. Falls back to the first FRONTEND_URL entry when unset. */
  FRONTEND_PUBLIC_URL: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),

  // External AI/data services. All optional until the client supplies credentials
  // (see docs/OPEN-QUESTIONS.md) — a missing key must degrade to a clear runtime
  // error on the affected route, not stop the server from booting.
  // Scrydex needs BOTH a key and a team id — one without the other 401s.
  SCRYDEX_API_KEY: z.string().optional(),
  SCRYDEX_TEAM_ID: z.string().optional(),
  SCRYDEX_BASE_URL: z.string().default("https://api.scrydex.com"),
  /**
   * Dev-only mock. DOUBLE-GATED: honored only when NODE_ENV is "development" —
   * in production this flag is dead weight by design.
   *
   *   false   nothing mocked (production, and dev once Vision is enabled)
   *   vision  identification faked, pricing real
   *   true    both faked
   *
   * `vision` exists because the client's credentials genuinely behave that way:
   * catalogue and pricing work, Vision 401s pending Scrydex entitlement. One
   * all-or-nothing flag would force a choice between a working scan flow and a
   * working price tracker.
   */
  MOCK_SCRYDEX: z.enum(["true", "false", "vision"]).default("false"),

  /**
   * Ceiling on cards re-priced per daily sweep.
   *
   * Env-tunable because it is a *budget* decision, not a code one — the right
   * number depends on the Scrydex tier the client is actually paying for, and
   * that has already changed once. Batched at 100 cards per credit, so the
   * default costs ~10 credits a day. See jobs/index.ts for the arithmetic.
   */
  DAILY_PRICE_BATCH: z.coerce.number().int().positive().default(1000),

  /**
   * Scrydex covers pricing on the SCRYDEX_* credentials — there is no separate
   * pricing vendor and no separate key. Retained only so the stored
   * `PriceSource` on historical rows keeps a meaning.
   */
  PRICING_SOURCE: z
    .enum(["tcgplayer", "pricecharting", "cardmarket", "scrydex"])
    .default("scrydex"),

  // AI grading — OpenAI only, per the client's service agreement.
  OPENAI_API_KEY: z.string().optional(),
  // Confirm against OpenAI's current model list — they ship new vision models
  // often and this default will go stale.
  OPENAI_GRADING_MODEL: z.string().default("gpt-4o"),
  /** Stamped onto every report AND used in the grading cache key. Bump it when
   *  the model or prompt changes, so old reports keep their original grade and
   *  new scans re-grade instead of mixing two models under one key.
   *
   *  v2 (2026-07-29): reworked prompt to the client's ordered workflow, plus
   *  imageQuality / measured centering / itemised defects in the output schema.
   *  v3 (2026-08-06): per-band scale anchors for corners/edges/surface, a
   *  required self-consistency pass, and defect descriptions that must state
   *  what the defect is, how visible it is, and what it cost the grade.
   *  v4 (2026-08-18): multi-image macro analysis rules, strict subscore capping,
   *  and fix for artificial grade boosting on damaged cards.
   *  Reports keep the grade they were issued under — none are back-filled. */
  GRADING_MODEL_VERSION: z.string().default("pixelgrade-v4"),

  // Slab background generation — vendor unconfirmed.
  IMAGEGEN_API_KEY: z.string().optional(),
  IMAGEGEN_BASE_URL: z.string().optional(),

  /** What fills the slab's card window. Defaults to `scan` — the card that was
   *  actually graded. See SLAB_CARD_RENDER_MODES for what the others cost you. */
  SLAB_CARD_RENDER_MODE: z.enum(SLAB_CARD_RENDER_MODES).default("scan"),

  /** Cloudflare Turnstile — bot protection on support ticket submission
   *  (client, 2026-08-10). Optional so the app still boots before the keys are
   *  provisioned; when the secret is absent, verification is SKIPPED and the
   *  server warns loudly at startup. Set it in production. */
  TURNSTILE_SECRET_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`\n❌ Invalid environment variables:\n${errors}\n`);
  process.exit(1);
}

const env = parsed.data;

// FRONTEND_URL is a comma-separated list of allowed CORS origins. The single
// canonical URL for redirects/emails/OAuth/Stripe is FRONTEND_PUBLIC_URL when
// set, otherwise the first FRONTEND_URL entry — so dev can keep localhost first
// for CORS while user-facing links still resolve to the live site.
const frontendUrls = env.FRONTEND_URL.split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const frontendPublicUrl =
  env.FRONTEND_PUBLIC_URL?.trim().replace(/\/+$/, "") ||
  frontendUrls[0] ||
  "*";

export const configs = {
  port: process.env.PORT || env.PORT || "8080",
  database_url: env.DATABASE_URL,
  node_env: env.NODE_ENV,

  jwt_access_secret: env.JWT_ACCESS_SECRET,
  jwt_access_expires: env.JWT_ACCESS_EXPIRES,
  jwt_refresh_secret: env.JWT_REFRESH_SECRET,
  jwt_refresh_expires: env.JWT_REFRESH_EXPIRES,
  jwt_reset_secret: env.JWT_RESET_SECRET,

  bcrypt_salt_round: env.BCRYPT_SALT_ROUND,

  super_admin_email: env.SUPER_ADMIN_EMAIL,
  super_admin_password: env.SUPER_ADMIN_PASSWORD,

  admin_email: env.ADMIN_EMAIL,
  admin_password: env.ADMIN_PASSWORD,

  google_client_id: env.GOOGLE_CLIENT_ID,
  google_client_secret: env.GOOGLE_CLIENT_SECRET,
  google_callback_url: env.GOOGLE_CALLBACK_URL,

  express_session_secret: env.EXPRESS_SESSION_SECRET,

  frontend_url: frontendPublicUrl,
  frontend_urls: frontendUrls,

  CLOUDINARY: {
    cloudinary_cloud_name: env.CLOUDINARY_CLOUD_NAME,
    cloudinary_api_key: env.CLOUDINARY_API_KEY,
    cloudinary_api_secret: env.CLOUDINARY_API_SECRET,
  },

  EMAIL_SENDER: {
    smtp_host: env.SMTP_HOST,
    smtp_port: env.SMTP_PORT,
    smtp_user: env.SMTP_USER,
    smtp_pass: env.SMTP_PASS,
    smtp_from: env.SMTP_FROM,
  },

  REDIS: {
    redis_host: env.REDIS_HOST,
    redis_port: env.REDIS_PORT,
    redis_username: env.REDIS_USERNAME,
    redis_password: env.REDIS_PASSWORD,
  },

  SCRYDEX: {
    api_key: env.SCRYDEX_API_KEY,
    team_id: env.SCRYDEX_TEAM_ID,
    base_url: env.SCRYDEX_BASE_URL,
    /** The NODE_ENV half of the double gate lives HERE, not at call sites —
     *  so no consumer can accidentally honor the flag in production. */
    mock_vision:
      (env.MOCK_SCRYDEX === "true" || env.MOCK_SCRYDEX === "vision") &&
      env.NODE_ENV === "development",
    mock_pricing:
      env.MOCK_SCRYDEX === "true" && env.NODE_ENV === "development",
  },

  PRICING: {
    source: env.PRICING_SOURCE,
    daily_batch: env.DAILY_PRICE_BATCH,
  },

  GRADING: {
    openai_api_key: env.OPENAI_API_KEY,
    openai_model: env.OPENAI_GRADING_MODEL,
    model_version: env.GRADING_MODEL_VERSION,
  },

  IMAGEGEN: {
    api_key: env.IMAGEGEN_API_KEY,
    base_url: env.IMAGEGEN_BASE_URL,
  },

  SLAB: {
    card_render_mode: env.SLAB_CARD_RENDER_MODE,
  },

  STRIPE: {
    secret_key: env.STRIPE_SECRET_KEY,
    webhook_secret: env.STRIPE_WEBHOOK_SECRET,
  },

  CAPTCHA: {
    turnstile_secret: env.TURNSTILE_SECRET_KEY,
    /** Verification only runs when a secret is configured — see captcha.provider. */
    enabled: Boolean(env.TURNSTILE_SECRET_KEY),
  },
};
