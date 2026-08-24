import http from "http";
import mongoose from "mongoose";
import app from "./app";
import { configs } from "./app/config/index";
import { connectRedis } from "./app/config/redis.config";
import { startJobs } from "./app/jobs/index";
import { warnIfFontsMissing } from "./app/modules/slab/slab.fonts";
import { warnIfCaptchaDisabled } from "./app/services/captcha.provider";
import { logger } from "./app/utils/logger";
import { seedAdmin } from "./app/utils/seedAdmin";
import { seedCmsPages } from "./app/utils/seedCmsPages";
import { seedPlans } from "./app/utils/seedPlans";
import { seedSuperAdmin } from "./app/utils/seedSuperAdmin";
import { initSocket } from "./socket/socket";

async function main() {
  try {
    const httpServer = http.createServer(app);

    // Bind the port FIRST, before anything that reaches the network.
    //
    // Everything below this line — sockets, Mongo, Redis, seeding — is either
    // already non-fatal or now runs after the process is answering requests.
    // The order was the other way round, which put an external dependency in
    // front of the listen call: on Elastic Beanstalk the health check is the
    // only thing that decides whether a deployment succeeded, so a dependency
    // that hangs during boot does not degrade the service, it fails the deploy
    // and rolls the version back.
    httpServer.listen(configs.port, () => {
      logger.info(
        `Server running on port ${configs.port} [${configs.node_env}]`,
      );
    });

    await initSocket(httpServer);

    try {
      await mongoose.connect(configs.database_url);
      logger.info("Connected to DB");
    } catch (dbErr) {
      logger.error("DB connection error:", { error: dbErr });
    }

    await connectRedis();

    try {
      await seedSuperAdmin();
      await seedAdmin();
      await seedPlans();
      await seedCmsPages();
    } catch (seedErr) {
      logger.warn("Seeding warning:", { error: seedErr });
    }

    warnIfCaptchaDisabled();
    warnIfFontsMissing();
    startJobs();
  } catch (error) {
    logger.error("Startup failed", { error });
  }
}

main();
