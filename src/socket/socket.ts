/* eslint-disable no-console */
import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HTTPServer } from "http";
import { JwtPayload } from "jsonwebtoken";
import { createClient } from "redis";
import { Server, Socket } from "socket.io";
import { configs } from "../app/config";
import { verifyToken } from "../app/utils/jwt";

interface AuthSocket extends Socket {
  user: JwtPayload;
}

let io: Server;

export const initSocket = async (httpServer: HTTPServer): Promise<Server> => {
  io = new Server(httpServer, {
    cors: {
      origin: configs.frontend_url === "*" ? true : configs.frontend_url,
      credentials: configs.frontend_url !== "*",
    },
  });

  // Redis adapter — allows horizontal scaling across multiple server instances
  const pubClient = createClient({
    username: configs.REDIS.redis_username ?? "default",
    password: configs.REDIS.redis_password ?? "",
    socket: {
      host: configs.REDIS.redis_host ?? "localhost",
      port: parseInt(configs.REDIS.redis_port ?? "6379"),
    },
  });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) => console.log("Socket Redis pub error:", err));
  subClient.on("error", (err) => console.log("Socket Redis sub error:", err));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.io Redis adapter connected.");

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
