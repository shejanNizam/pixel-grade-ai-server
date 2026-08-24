import { createClient } from "redis";
import { logger } from "../utils/logger";
import { configs } from "./index";

/**
 * Only the event surface, deliberately. node-redis parameterises its client type
 * over modules, functions, scripts and RESP version, and the concrete type of a
 * `createClient(...)` call does not unify with the abstract `RedisClientType` —
 * so naming that type here would make this helper reject the very clients it is
 * written for. It needs `.on` and nothing else.
 */
interface RedisLifecycleEvents {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  on(event: "reconnecting" | "ready", listener: () => void): unknown;
}

/**
 * One place the Redis endpoint is described. The Socket.io adapter opens its own
 * pub/sub pair off the same options — three connections to one server, so they
 * must not be able to drift apart.
 */
// Logged at boot because "which Redis is this talking to?" is the first
// question every connection failure raises, and the default is localhost —
// which on a deployed instance is nothing at all.
//
// The password is reported as present/absent, never printed: this runs on every
// start, and on Elastic Beanstalk stdout is shipped straight to CloudWatch,
// where it becomes a credential sitting in a log group with a far wider reader
// list than the environment's configuration page.
logger.info("Redis connection options", {
  host: configs.REDIS.redis_host ?? "localhost (no REDIS_HOST configured)",
  port: parseInt(configs.REDIS.redis_port ?? "6379"),
  username: configs.REDIS.redis_username ?? "default",
  password: configs.REDIS.redis_password ? "[set]" : "[empty]",
});

export const redisConnectionOptions = {
  username: configs.REDIS.redis_username ?? "default",
  password: configs.REDIS.redis_password ?? "",
  socket: {
    host: configs.REDIS.redis_host ?? "localhost",
    port: parseInt(configs.REDIS.redis_port ?? "6379"),
  },
};

/**
 * Connection lifecycle logging, shared by every client.
 *
 * Redis connections drop and come back on their own: a hosted provider culls
 * sockets that have been idle, and a suspended machine wakes to find all of them
 * reset (`ECONNRESET` on read). node-redis reconnects without help, so the gap
 * was never reliability — it was that recovery left no trace. The failure was
 * logged and the repair was not, which made a blip that healed in a second look
 * exactly like a Redis that never came back.
 *
 * Repeats of an identical error are swallowed until the client is `ready` again,
 * so a long outage costs one line per distinct fault instead of one per retry.
 */
export const attachRedisLogging = (
  client: RedisLifecycleEvents,
  label: string,
): void => {
  let hasConnected = false;
  let lastErrorCode: string | undefined;

  client.on("error", (error: NodeJS.ErrnoException) => {
    const code = error?.code ?? error?.name ?? "unknown";
    // No `console.log` beside the logger call below: it duplicated every line
    // and, because it ran before the repeat check, it defeated the suppression
    // this function exists to provide — an unreachable Redis retries forever,
    // so that is an unbounded stream of identical lines into CloudWatch.
    if (code === lastErrorCode) return;
    lastErrorCode = code;

    logger.error(`${label} error`, {
      code,
      syscall: error?.syscall,
      message: error?.message,
    });
  });

  client.on("reconnecting", () => logger.warn(`${label} reconnecting`));

  // `ready` also fires on the very first connect, which connectRedis already
  // reports — only the later ones are news.
  client.on("ready", () => {
    if (hasConnected) logger.info(`${label} reconnected`);
    hasConnected = true;
    lastErrorCode = undefined;
  });
};

export const redisClient = createClient(redisConnectionOptions);

attachRedisLogging(redisClient, "Redis client");

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
      logger.info("Redis Connected!");
    } catch (err) {
      logger.warn("Redis connection warning (non-fatal):", { error: err });
    }
  }
};
