import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HTTPServer } from "http";
import { JwtPayload } from "jsonwebtoken";
import { createClient } from "redis";
import { Server, Socket } from "socket.io";
import { configs } from "../app/config";
import {
  attachRedisLogging,
  redisConnectionOptions,
} from "../app/config/redis.config";
import { verifyToken } from "../app/utils/jwt";
import { logger } from "../app/utils/logger";

interface AuthSocket extends Socket {
  user: JwtPayload;
}

let io: Server;

export const initSocket = async (httpServer: HTTPServer): Promise<Server> => {
  io = new Server(httpServer, {
    cors: {
      origin: configs.frontend_urls.includes("*") ? true : configs.frontend_urls,
      credentials: !configs.frontend_urls.includes("*"),
    },
  });

  // Redis adapter — allows horizontal scaling across multiple server instances.
  //
  // ⚠️ Attached in the BACKGROUND, and its failure is not fatal.
  //
  // This was `await`ed, and `initSocket` is itself awaited before the HTTP
  // server binds its port. That made a reachable Redis a hard precondition of
  // the process listening at all: with REDIS_HOST unset the client falls back
  // to localhost:6379, node-redis retries a connection that will never succeed,
  // and the await never settles. Nothing crashes and nothing logs — the port
  // simply never opens, so nginx 502s, the load balancer reports the instance
  // unhealthy, and the deployment hangs until the command timeout rolls it
  // back. That is the 2026-08-24 (app-317) failure.
  //
  // `connectRedis` in the boot sequence was already written to treat Redis as
  // non-fatal; this path quietly was not. Without the adapter Socket.io falls
  // back to its in-memory adapter, which is correct for a single instance and
  // degrades only cross-instance fan-out — a far better failure than a server
  // that will not start. node-redis keeps retrying, so the adapter attaches on
  // its own if Redis comes back.
  const pubClient = createClient(redisConnectionOptions);
  const subClient = pubClient.duplicate();

  attachRedisLogging(pubClient, "Socket Redis pub");
  attachRedisLogging(subClient, "Socket Redis sub");

  void Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
      io.adapter(createAdapter(pubClient, subClient));
      logger.info("Socket.io Redis adapter connected.");
    })
    .catch((error) => {
      logger.error(
        "Socket.io Redis adapter unavailable — real-time events will not " +
          "reach clients connected to other instances.",
        { error },
      );
    });

  // JWT authentication middleware — runs before every connection
  io.use((socket: Socket, next) => {
    const token = (socket as AuthSocket).handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Authentication required"));

    try {
      const decoded = verifyToken(token, configs.jwt_access_secret) as JwtPayload;
      (socket as AuthSocket).user = decoded;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const { _id: userId } = (socket as AuthSocket).user;

    // Every user joins their personal room on connect — used to push targeted events
    socket.join(`user:${userId}`);

    // Join a conversation room to receive messages and typing indicators for that chat
    socket.on("join_conversation", (conversationId: string) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Relay typing indicators to the other participant(s) in the conversation
    socket.on("typing", ({ conversationId }: { conversationId: string }) => {
      socket.to(`conv:${conversationId}`).emit("typing", { conversationId, userId });
    });

    socket.on("stop_typing", ({ conversationId }: { conversationId: string }) => {
      socket.to(`conv:${conversationId}`).emit("stop_typing", { conversationId, userId });
    });

    socket.on("disconnect", () => {
      socket.leave(`user:${userId}`);
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
};

/**
 * Emit an event to a specific user regardless of which socket they're connected from.
 * Safe to call before socket init — silently skips if not ready.
 */
export const emitToUser = (userId: string, event: string, data: unknown): void => {
  try {
    getIO().to(`user:${userId}`).emit(event, data);
  } catch {
    // socket not yet initialized (e.g. during seeding), skip silently
  }
};

/**
 * Emit an event to all sockets that joined a conversation room.
 * Reaches users who currently have that chat open.
 */
export const emitToConversation = (conversationId: string, event: string, data: unknown): void => {
  try {
    getIO().to(`conv:${conversationId}`).emit(event, data);
  } catch {
    // socket not yet initialized, skip silently
  }
};
