import { createClient } from "redis";
import { configs } from "./index";
import { logger } from "../utils/logger";

export const redisClient = createClient({
  username: configs.REDIS.redis_username ?? "default",
  password: configs.REDIS.redis_password ?? "",
  socket: {
    host: configs.REDIS.redis_host ?? "localhost",
    port: parseInt(configs.REDIS.redis_port ?? "6379"),
  },
});

redisClient.on("error", (err) => logger.error("Redis Client Error", { err }));

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    logger.info("Redis Connected!");
  }
};
