import http, { Server } from "http";
import mongoose from "mongoose";
import app from "./app";
import { configs } from "./app/config/index";
import { connectRedis } from "./app/config/redis.config";
import { startJobs } from "./app/jobs/index";
import { logger } from "./app/utils/logger";
import { seedAdmin } from "./app/utils/seedAdmin";
import { seedCmsPages } from "./app/utils/seedCmsPages";
import { warnIfCaptchaDisabled } from "./app/services/captcha.provider";
import { seedPlans } from "./app/utils/seedPlans";
import { seedSuperAdmin } from "./app/utils/seedSuperAdmin";
import { initSocket } from "./socket/socket";

let server: Server;

async function main() {
  try {
    await mongoose.connect(configs.database_url);
    logger.info("Connected to DB");

    await connectRedis();
    await seedSuperAdmin();
    await seedAdmin();
    // Credit wallets resolve their allowance through a plan, so the four tiers
    // must exist before any user can be granted credits or run a scan.
    await seedPlans();
    await seedCmsPages();

    // Surfaces a deploy that left spam protection off — see captcha.provider.
    warnIfCaptchaDisabled();

    const httpServer = http.createServer(app);
    await initSocket(httpServer);

    // Started after the DB and seeders are ready — the credit jobs resolve
    // plans, so the four tiers must already exist.
    startJobs();

    server = httpServer.listen(configs.port, () => {
      logger.info(
        `Server running on port ${configs.port} [${configs.node_env}]`,
      );
    });
  } catch (error) {
    logger.error("Startup failed", { error });
    process.exit(1);
  }
}
main();

// const gracefulShutdown = async (signal: string, exitCode: number) => {
//   logger.info(`${signal} received — shutting down gracefully`);
//   if (server) {
//     server.close(async () => {
//       await mongoose.connection.close();
//       await redisClient.quit();
//       logger.info("Server closed");
//       process.exit(exitCode);
//     });
//   } else {
//     process.exit(exitCode);
//   }
// };

// process.on("SIGTERM", () => gracefulShutdown("SIGTERM", 0));
// process.on("SIGINT", () => gracefulShutdown("SIGINT", 0));

// process.on("unhandledRejection", (err) => {
//   logger.error("Unhandled Rejection", { error: err });
//   gracefulShutdown("unhandledRejection", 1);
// });

// process.on("uncaughtException", (err) => {
//   logger.error("Uncaught Exception", { error: err });
//   gracefulShutdown("uncaughtException", 1);
// });
