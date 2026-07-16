import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { User } from "../modules/user/user.model";
import { verifyToken } from "../utils/jwt";

export const checkAuth =
  (...authRole: string[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const accessToken = req.headers.authorization?.split(" ")[1];

      if (!accessToken) {
        throw new AppError(httpStatus.FORBIDDEN, "Please provide a valid access token.");
      }

      const verifiedToken = verifyToken(
        accessToken,
        configs.jwt_access_secret,
      ) as JwtPayload;

      const user = await User.findOne({ email: verifiedToken.email });

      if (!user) {
        throw new AppError(httpStatus.UNAUTHORIZED, "User does not exist");
      }
      if (!user.isEmailVerified) {
        throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
      }
      if (user.status === "blocked") {
        throw new AppError(httpStatus.FORBIDDEN, "Account is blocked");
      }
      if (user.isDeleted) {
        throw new AppError(httpStatus.FORBIDDEN, "Account has been deleted");
      }
      if (!authRole.includes(verifiedToken.role)) {
        throw new AppError(httpStatus.FORBIDDEN, "You are not permitted to access this route.");
      }

      req.user = verifiedToken;
      next();
    } catch (error) {
      next(error);
    }
  };

export const checkResetToken = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      throw new AppError(httpStatus.UNAUTHORIZED, "No reset token provided.");
    }
    const decoded = verifyToken(token, configs.jwt_reset_secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    next(error);
  }
};
