import { Router } from "express";
import { healthCheck, liveness } from "./health.controller";

const router = Router();

// GET /health — readiness probe (checks DB + Redis)
router.get("/", healthCheck);

// GET /health/live — liveness probe (just "am I running?")
router.get("/live", liveness);

export const HealthRoutes = router;
