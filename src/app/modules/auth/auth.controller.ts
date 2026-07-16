/* eslint-disable @typescript-eslint/no-unused-vars */
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";

import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import passport from "passport";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import sendResponse from "../../utils/sendResponse";
import { setAuthCookie } from "../../utils/setCookie";
import { createUserTokens } from "../../utils/userTokens";
import { IUser } from "../user/user.interface";
import { AuthServices } from "./auth.service";

// for manual login with credentials ------------>>
// const credentialsLogin = catchAsync(
//   async (req: Request, res: Response, next: NextFunction) => {
//     const loginInfo = await AuthServices.credentialLogin(req.body);

//     setAuthCookie(res, loginInfo);

//     sendResponse(res, {
//       statusCode: httpStatus.CREATED,
//       success: true,
//       message: "User loggedin successfully!",
//       data: loginInfo,
//     });
//   },
// );

// for manual login with credentials  using passport js ------------>>
const credentialsLogin = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate(
      "local",
      async (
        err: Error | null,
        user: IUser | false,
        info: { message: string },
      ) => {
        if (err) {
          return next(
            new AppError(httpStatus.INTERNAL_SERVER_ERROR, err.message),
          );
        }

        if (!user) {
          return next(new AppError(httpStatus.UNAUTHORIZED, info.message));
        }

        const userTokens = createUserTokens(user);

        const { password: _password, ...rest } = user.toObject();

        setAuthCookie(res, userTokens);

        sendResponse(res, {
          success: true,
          statusCode: httpStatus.OK,
          message: "User Logged In Successfully",
          data: {
            user: rest,
            accessToken: userTokens.accessToken,
            refreshToken: userTokens.refreshToken,
          },
        });
      },
    )(req, res, next);
  },
);

const getNewAccessToken = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "No refresh token received from cookies!",
      );
    }
    const tokenInfo = await AuthServices.getNewAccessToken(
      refreshToken as string,
    );
    setAuthCookie(res, tokenInfo);

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "New access token retrive successfully!",
      data: tokenInfo,
    });
  },
);

const logout = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: configs.node_env === "production",
      sameSite: "lax",
    });
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "User logged out successfully!",
      data: null,
    });
  },
);

const changePassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const oldPassword = req.body.oldPassword;
    const newPassword = req.body.newPassword;
    const decodedToken = req.user;

    await AuthServices.changePassword(
      oldPassword,
      newPassword,
      decodedToken as JwtPayload,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Password changed successfully!",
      data: null,
    });
  },
);

const setPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const decodedToken = req.user as JwtPayload;
    const { password } = req.body;

    await AuthServices.setPassword(decodedToken._id, password);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Password set successfully!",
      data: null,
    });
  },
);

const forgotPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email } = req.body;

    await AuthServices.forgotPassword(email);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Email sent successfully!",
      data: null,
    });
  },
);

const resetPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const decodedToken = req.user;
    // console.log(decodedToken);

    await AuthServices.resetPassword(req.body, decodedToken as JwtPayload);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Password reset successfully!",
      data: null,
    });
  },
);

//  for google authentication
const googleCallbackControll = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      throw new AppError(httpStatus.NOT_FOUND, "User not found!");
    }

    const tokenInfo = createUserTokens(user);
    setAuthCookie(res, tokenInfo);

    if (!configs.frontend_url) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Frontend URL not configured",
      );
    }

    const rawState = (req.query.state as string) || "/";

    const isRelative = rawState.startsWith("/") && !rawState.startsWith("//");

    const safePath = /^\/[a-zA-Z0-9\-._~:@!$&'()*+,;=%/?#]*$/.test(rawState)
      ? rawState
      : "/";

    res.redirect(`${configs.frontend_url}${safePath}`);
  },
);

export const AuthControllers = {
  credentialsLogin,
  getNewAccessToken,
  logout,
  changePassword,
  setPassword,
  forgotPassword,
  resetPassword,
  googleCallbackControll,
};
