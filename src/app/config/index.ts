import dotenv from "dotenv";
import path from "path";
import { z } from "zod";
import { SLAB_CARD_RENDER_MODES } from "../constants";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const envSchema = z.object({
  PORT: z.string().default("5000"),
  DATABASE_URL: z.string().default("mongodb+srv://pixelgrade:pixelgrade123@cluster0.mongodb.net/pixelgrade?retryWrites=true&w=majority"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),

  JWT_ACCESS_SECRET: z.string().default("super_secret_jwt_access_token_pixelgrade_2026"),
  JWT_ACCESS_EXPIRES: z.string().default("1d"),
  JWT_REFRESH_SECRET: z.string().default("super_secret_jwt_refresh_token_pixelgrade_2026"),
  JWT_REFRESH_EXPIRES: z.string().default("30d"),
  JWT_RESET_SECRET: z.string().default("super_secret_jwt_reset_token_pixelgrade_2026"),

  BCRYPT_SALT_ROUND: z.string().default("10"),

  SUPER_ADMIN_EMAIL: z.string().default("admin@pixelgradeai.com"),
  SUPER_ADMIN_PASSWORD: z.string().default("Admin@123456"),
  ADMIN_EMAIL: z.string().default("admin@pixelgradeai.com"),
  ADMIN_PASSWORD: z.string().default("Admin@123456"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),

  EXPRESS_SESSION_SECRET: z.string().default("super_secret_express_session_token_pixelgrade_2026"),

  FRONTEND_URL: z.string().default("*"),
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

  SCRYDEX_API_KEY: z.string().optional(),
  SCRYDEX_TEAM_ID: z.string().optional(),
  SCRYDEX_BASE_URL: z.string().default("https://api.scrydex.com"),

  MOCK_SCRYDEX: z.enum(["true", "false", "vision"]).default("false"),
  DAILY_PRICE_BATCH: z.coerce.number().int().positive().default(1000),

  PRICING_SOURCE: z
    .enum(["tcgplayer", "pricecharting", "cardmarket", "scrydex"])
    .default("scrydex"),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_GRADING_MODEL: z.string().default("gpt-4o"),
  GRADING_MODEL_VERSION: z.string().default("pixelgrade-v4"),

  IMAGEGEN_API_KEY: z.string().optional(),
  IMAGEGEN_BASE_URL: z.string().optional(),

  SLAB_CARD_RENDER_MODE: z.enum(SLAB_CARD_RENDER_MODES).default("scan"),
  TURNSTILE_SECRET_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`\n❌ Invalid environment variables:\n${errors}\n`);
}

const env = parsed.success ? parsed.data : envSchema.parse({});

const frontendUrls = env.FRONTEND_URL.split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const frontendPublicUrl =
  env.FRONTEND_PUBLIC_URL?.trim().replace(/\/+$/, "") ||
  frontendUrls[0] ||
  "*";

export const configs = {
  port: process.env.PORT || env.PORT || "5000",
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
    enabled: Boolean(env.TURNSTILE_SECRET_KEY),
  },
};
