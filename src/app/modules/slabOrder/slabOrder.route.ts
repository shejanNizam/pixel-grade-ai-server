import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import { UserRole } from "../user/user.interface";
import { SlabOrderControllers } from "./slabOrder.controller";

const router = Router();
const anyUser = Object.values(UserRole);

router.post("/", checkAuth(...anyUser), SlabOrderControllers.createOrder);
router.post("/create-checkout-session", checkAuth(...anyUser), SlabOrderControllers.createStripeCheckout);
router.get("/my-orders", checkAuth(...anyUser), SlabOrderControllers.getMyOrders);
router.get("/:id", checkAuth(...anyUser), SlabOrderControllers.getOrderById);

router.get(
  "/admin/all",
  checkAuth(UserRole.admin, UserRole.super_admin),
  SlabOrderControllers.getAllOrders,
);
router.post(
  "/admin/:id/purchase-label",
  checkAuth(UserRole.admin, UserRole.super_admin),
  SlabOrderControllers.purchaseLabel,
);
router.patch(
  "/admin/:id",
  checkAuth(UserRole.admin, UserRole.super_admin),
  SlabOrderControllers.updateOrderStatus,
);

export const SlabOrderRoutes = router;
