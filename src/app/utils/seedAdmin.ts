import bcrypt from "bcrypt";
import { configs } from "../config/index";
import { AuthIdentity } from "../modules/auth_identity/auth_identity.model";
import { IUserInitial, UserRole } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { logger } from "./logger";

export const seedAdmin = async () => {
  try {
    const exists = await User.findOne({ email: configs.admin_email });
    if (exists) {
      logger.info("Admin already exists");
      return;
    }

    logger.info("Creating Admin...");

    const hashedPassword = await bcrypt.hash(
      configs.admin_password,
      Number(configs.bcrypt_salt_round),
    );

    const payload: IUserInitial = {
      name: "Admin",
      role: UserRole.admin,
      email: configs.admin_email,
      password: hashedPassword,
      isEmailVerified: true,
      status: "active",
      isDeleted: false,
    };

    const admin = await User.create(payload);

    await AuthIdentity.create({
      userId: admin._id,
      provider: "local",
      providerId: configs.admin_email,
    });

    logger.info("Admin created successfully.");
  } catch (error) {
    logger.error("Failed to seed admin", { error });
  }
};
