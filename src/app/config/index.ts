import { z } from "zod";

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`\n❌ Invalid environment variables:\n${errors}\n`);
  process.exit(1);
}

const env = parsed.data;

export const configs = {
  port: env.PORT,
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

  frontend_url: env.FRONTEND_URL,

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
};
