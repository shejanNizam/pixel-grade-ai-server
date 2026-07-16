import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.route";
import { DeviceTokenRoutes } from "../modules/device_token/device_token.route";
import { OtpRoutes } from "../modules/otp/otp.route";
import { UploadRoutes } from "../modules/upload/upload.route";
import { UserRoutes } from "../modules/user/user.route";

const router = Router();

const moduleRoutes = [
  { path: "/auth", route: AuthRoutes },
  { path: "/user", route: UserRoutes },
  { path: "/otp", route: OtpRoutes },
  { path: "/device-token", route: DeviceTokenRoutes },
  { path: "/upload", route: UploadRoutes },
];

moduleRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
