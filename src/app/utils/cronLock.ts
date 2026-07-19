import crypto from "crypto";
import { redisClient } from "../config/redis.config";
import { logger } from "./logger";

/**
 * Cross-instance mutex for cron jobs.
 *
 * node-cron fires in EVERY process, so on a multi-instance deploy each replica
 * would run the same job — and the credit grants would pay out N× (the exact
 * footgun CLAUDE.md warns about). The first instance to claim the Redis key
 * runs the job; the rest skip that tick.
 *
 * Failure posture is deliberately asymmetric:
 *  - Redis DOWN → run WITHOUT the lock. A single-instance deploy (the current
 *    reality) must never skip credit grants because Redis blinked; a
 *    multi-instance deploy with Redis down has bigger problems than a double
 *    grant, and `grantAllowance` is a reset rather than an increment anyway.
 *  - Lock HELD → skip silently. Another instance is doing the work.
 *
 * The lock value is a random token and release is token-checked, so an
 * instance that stalls past the TTL cannot release a lock that a newer
 * claimant now holds.
 */
export const withCronLock = async (
  name: string,
  ttlSeconds: number,
  job: () => Promise<void>,
): Promise<void> => {
  const key = `cronlock:${name}`;
  const token = crypto.randomUUID();

  let claimed: string | null;
  try {
    claimed = await redisClient.set(key, token, {
      NX: true,
      EX: ttlSeconds,
    });
  } catch (error) {
    logger.warn("Cron lock unavailable — running without it", { name, error });
    await job();
    return;
  }

  if (claimed === null) return; // another instance holds this tick

  try {
    await job();
  } finally {
    try {
      // Token-checked release: only the holder may delete.
      const current = await redisClient.get(key);
      if (current === token) await redisClient.del(key);
    } catch (error) {
      logger.warn("Cron lock release failed — TTL will clear it", {
        name,
        error,
      });
    }
  }
};
