import { Request, Response } from "express";
import mongoose from "mongoose";
import { redisClient } from "../../config/redis.config";

export const healthCheck = async (_req: Request, res: Response) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus = mongoState === 1 ? "connected" : "disconnected";

  let redisStatus = "disconnected";
  try {
    await redisClient.ping();
    redisStatus = "connected";
  } catch {
    // redis unavailable — status stays "disconnected"
  }

  const isHealthy = mongoStatus === "connected" && redisStatus === "connected";

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    services: {
      database: mongoStatus,
      redis: redisStatus,
    },
  });
};

// Lightweight liveness probe — no DB/Redis check, just "am I up?"
export const liveness = (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
};
