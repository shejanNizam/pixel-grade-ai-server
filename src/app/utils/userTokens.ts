import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { IUser } from "../modules/user/user.interface";
import { User } from "../modules/user/user.model";
import { generateToken, verifyToken } from "./jwt";

export const createUserTokens = (user: Partial<IUser>) => {
  const jwtPayload = {
    _id: user._id?.toString(),
    email: user.email,
    role: user.role,
  };

  const accessToken = generateToken(
    jwtPayload,
    configs.jwt_access_secret,
    configs.jwt_access_expires,
  );

  const refreshToken = generateToken(
    jwtPayload,
    configs.jwt_refresh_secret,
    configs.jwt_refresh_expires,
  );

  return { accessToken, refreshToken };
};

export const createNewAccessTokenWithRefreshToken = async (
  refreshToken: string,
) => {
  const verifiedRefreshToken = verifyToken(
    refreshToken,
    configs.jwt_refresh_secret,
  ) as JwtPayload;

  const user = await User.findOne({ email: verifiedRefreshToken.email });

  if (!user) {
    throw new AppError(httpStatus.BAD_REQUEST, "User does not exist");
  }
  if (user.status === "blocked") {
    throw new AppError(httpStatus.FORBIDDEN, "Account is blocked");
  }
  if (user.isDeleted) {
    throw new AppError(httpStatus.FORBIDDEN, "Account has been deleted");
  }

  const jwtPayload = {
    _id: user._id?.toString(),
    email: user.email,
    role: user.role,
  };

  return generateToken(
    jwtPayload,
    configs.jwt_access_secret,
    configs.jwt_access_expires,
  );
};
