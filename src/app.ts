import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import mongoSanitize from "express-mongo-sanitize";
import expressSession from "express-session";
import { xss } from "express-xss-sanitizer";
import helmet from "helmet";
import morgan from "morgan";
import passport from "passport";
import swaggerUi from "swagger-ui-express";
import { configs } from "./app/config/index";
import "./app/config/passport";
import { swaggerSpec } from "./app/config/swagger.config";
import { globalErrorHandler } from "./app/middlewares/globalErrorHandler";
import notFound from "./app/middlewares/notFound";
import { globalLimiter } from "./app/middlewares/rateLimiter";
import { requestId } from "./app/middlewares/requestId";
import { HealthRoutes } from "./app/modules/health/health.route";
import { StripeWebhookRoutes } from "./app/modules/subscription/subscription.route";
import router from "./app/routes/index";
import { logger } from "./app/utils/logger";

const app: Application = express();

// Assign a correlation ID to every request before anything else
app.use(requestId);

// Security & performance — must come before body parsers
app.use(helmet());
app.use(compression());
app.use(
  morgan(configs.node_env === "production" ? "combined" : "dev", {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }),
);
// Two proxies sit in front of this process on Elastic Beanstalk: the load
// balancer, then the instance's own nginx. The ALB appends the caller to
// X-Forwarded-For and nginx appends the ALB, so the chain arrives as
// `<client>, <alb>` and only a hop count of 2 resolves req.ip to the client.
//
// At 1, Express stopped one hop short and read the ALB's address as the
// client, which put every visitor on the planet into a single rate-limit
// bucket — 200 requests per 15 minutes for the whole site, after which
// everyone including the load balancer's own health check gets a 429. That is
// the "100.0% of the requests are erroring with HTTP 4xx" the environment
// reported on 2026-08-31.
//
// 2 is not more permissive than 1: a spoofed X-Forwarded-For entry sent by a
// client lands to the LEFT of the ALB's own append, so it is never one of the
// two trusted hops and can only displace itself.
app.set("trust proxy", 2);

// Stripe webhook — mounted BEFORE the rate limiter and the JSON parser.
//   • Before globalLimiter: a burst of legitimate Stripe events must never be
//     rate-limited into retries.
//   • Before express.json(): signature verification hashes the exact bytes
//     Stripe sent, and a JSON parse-and-restringify changes them, so every
//     event would fail verification.
// Authenticity comes from the HMAC signature, not from a bearer token.
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  StripeWebhookRoutes,
);

// Health checks — mounted BEFORE globalLimiter, and outside /api/v1 so infra
// probes need no auth headers. The load balancer polls this from every AZ for
// the life of the environment; behind the limiter those probes both consume
// the budget and eventually get 429'd by it, which reads to EB as the instance
// being down and fails the deployment that was otherwise fine. A health check
// that can be rate-limited is not a health check.
app.use("/health", HealthRoutes);

app.use(globalLimiter);

// Body parsers (allow up to 50mb for high-resolution card photo uploads)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Input sanitization — runs after body is parsed
// express-mongo-sanitize tries to replace req.query which is a getter-only property
// in newer router versions, so we sanitize req.query in-place instead
app.use((req, _res, next) => {
  if (req.body) req.body = mongoSanitize.sanitize(req.body);
  if (req.params) req.params = mongoSanitize.sanitize(req.params);
  if (req.query) {
    const clean = mongoSanitize.sanitize({ ...req.query });
    Object.keys(req.query).forEach((k) =>
      Reflect.deleteProperty(req.query as Record<string, unknown>, k),
    );
    Object.assign(req.query, clean);
  }
  next();
});
app.use(xss());

app.use(cookieParser());
app.use(
  cors({
    origin: configs.frontend_urls.includes("*") ? true : configs.frontend_urls,
    credentials: !configs.frontend_urls.includes("*"),
  }),
);
app.use(
  expressSession({
    secret: configs.express_session_secret,
    resave: false,
    saveUninitialized: false,
  }),
);
app.use(passport.initialize());
app.use(passport.session());

// API docs — only expose in non-production environments
if (configs.node_env !== "production") {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api/docs.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });
}

app.use("/api/v1", router);

app.get("/", (_req: Request, res: Response) => {
  res.send("Pixel Grade AI Server is running");
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
