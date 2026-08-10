import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { SlabOrderControllers } from "./slabOrder.controller";

const router = Router();
const anyUser = Object.values(UserRole);

router.post("/", checkAuth(...anyUser), SlabOrderControllers.createOrder);
router.get("/my-orders", checkAuth(...anyUser), SlabOrderControllers.getMyOrders);
router.get(
  "/admin/all",
  checkAuth(UserRole.admin, UserRole.super_admin),
  SlabOrderControllers.getAllOrders,
);
router.patch(
  "/admin/:id",
  checkAuth(UserRole.admin, UserRole.super_admin),
  SlabOrderControllers.updateOrderStatus,
);

export const SlabOrderRoutes = router;
