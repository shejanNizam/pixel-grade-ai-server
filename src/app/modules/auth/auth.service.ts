import bcrypt from "bcrypt";
import httpStatus from "http-status";
import jwt, { JwtPayload } from "jsonwebtoken";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { AuthIdentity } from "../auth_identity/auth_identity.model";
import { IUser } from "../user/user.interface";
import { User } from "../user/user.model";
import { sendEmail } from "../../utils/sendEmail";
import {
  createNewAccessTokenWithRefreshToken,
  createUserTokens,
} from "../../utils/userTokens";

const credentialLogin = async (payload: Partial<IUser>) => {
  const { email, password } = payload;

  if (!email) throw new AppError(httpStatus.BAD_REQUEST, "Email is required");

  const isUserExist = await User.findOne({ email }).select("+password");
  if (!isUserExist) {
    throw new AppError(httpStatus.NOT_FOUND, "User with this email not found");
  }

  if (!isUserExist.password) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "No password set. Please login with Google.",
    );
  }

  if (!isUserExist.isEmailVerified) {
    throw new AppError(httpStatus.FORBIDDEN, "Please verify your email before logging in");
  }
  if (isUserExist.status === "blocked") {
    throw new AppError(httpStatus.FORBIDDEN, "Your account has been blocked");
  }
  if (isUserExist.isDeleted) {
    throw new AppError(httpStatus.FORBIDDEN, "Account no longer exists");
  }

  const isPasswordMatch = await bcrypt.compare(
    password as string,
    isUserExist.password,
  );
  if (!isPasswordMatch) {
    throw new AppError(httpStatus.BAD_REQUEST, "Incorrect password");
  }

  const userTokens = createUserTokens(isUserExist);

  await User.findByIdAndUpdate(isUserExist._id, {
    lastLoginAt: new Date(),
  });

  const userObj = isUserExist.toObject();
  delete userObj.password;

  return {
    accessToken: userTokens.accessToken,
    refreshToken: userTokens.refreshToken,
    user: userObj,
  };
};

const getNewAccessToken = async (refreshToken: string) => {
  const newAccessToken =
    await createNewAccessTokenWithRefreshToken(refreshToken);
  return { accessToken: newAccessToken };
};

const changePassword = async (
  oldPassword: string,
  newPassword: string,
  decodedToken: JwtPayload,
) => {
  const user = await User.findById(decodedToken._id).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (!oldPassword || !newPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Old and new passwords are required",
    );
  }
  if (oldPassword === newPassword) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "New password cannot be the same as the old password",
    );
  }

  const isMatch = await bcrypt.compare(oldPassword, user.password as string);
  if (!isMatch) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Old password does not match");
  }

  user.password = await bcrypt.hash(
    newPassword,
    Number(configs.bcrypt_salt_round),
  );
  await user.save();
};

const setPassword = async (userId: string, plainPassword: string) => {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  const localIdentity = await AuthIdentity.findOne({
    userId,
    provider: "local",
  });
  if (localIdentity && user.password) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Password already set. Use change-password instead.",
    );
  }

  user.password = await bcrypt.hash(
    plainPassword,
    Number(configs.bcrypt_salt_round),
  );
  await user.save();

  if (!localIdentity) {
    await AuthIdentity.create({
      userId: user._id,
      provider: "local",
      providerId: user.email,
    });
  }
};

const forgotPassword = async (email: string) => {
  const user = await User.findOne({ email });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  if (!user.isEmailVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Email is not verified");
  }
  if (user.status === "blocked") {
    throw new AppError(httpStatus.BAD_REQUEST, "Account is blocked");
  }
  if (user.isDeleted) {
    throw new AppError(httpStatus.BAD_REQUEST, "Account has been deleted");
  }

  const resetToken = jwt.sign(
    { _id: user._id?.toString(), email: user.email, role: user.role },
    configs.jwt_reset_secret,
    { expiresIn: "10m" },
  );

  const resetUILink = `${configs.frontend_url}/reset-password?id=${user._id}&token=${resetToken}`;

  await sendEmail({
    to: user.email,
    subject: "Password Reset",
    templateName: "forgetPassword",
    templateData: { name: user.name, resetUILink },
  });
};

const resetPassword = async (
  payload: Record<string, string>,
  decodedToken: JwtPayload,
) => {
  const { id, newPassword } = payload;

  if (!id || !newPassword) {
    throw new AppError(httpStatus.BAD_REQUEST, "Id and new password required");
  }
  if (id !== decodedToken._id) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Cannot reset password");
  }

  const user = await User.findById(decodedToken._id);
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  user.password = await bcrypt.hash(
    newPassword,
    Number(configs.bcrypt_salt_round),
  );
  await user.save();
};

export const AuthServices = {
  credentialLogin,
  getNewAccessToken,
  changePassword,
  setPassword,
  forgotPassword,
  resetPassword,
};
