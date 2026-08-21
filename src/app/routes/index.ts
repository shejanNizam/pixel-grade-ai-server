import { Router } from "express";
import { ActivityLogRoutes } from "../modules/activity_log/activity_log.route";
import { AnalysisRoutes } from "../modules/analysis/analysis.route";
import { AuthRoutes } from "../modules/auth/auth.route";
import { CardRoutes } from "../modules/card/card.route";
import { CmsRoutes } from "../modules/cms/cms.route";
import { CollectionRoutes } from "../modules/collection/collection.route";
import { CreditRoutes } from "../modules/credit/credit.route";
import { DashboardRoutes } from "../modules/dashboard/dashboard.route";
import { GradingRoutes } from "../modules/grading/grading.route";
import { NotificationRoutes } from "../modules/notification/notification.route";
import { OtpRoutes } from "../modules/otp/otp.route";
import { PlanRoutes } from "../modules/plan/plan.route";
import { PriceRoutes } from "../modules/price/price.route";
import { SlabRoutes } from "../modules/slab/slab.route";
import { SlabOrderRoutes } from "../modules/slabOrder/slabOrder.route";
import { cartRoutes } from "../modules/cart/cart.route";
import { shippoRoutes } from "../modules/shippo/shippo.route";
import { SubscriptionRoutes } from "../modules/subscription/subscription.route";
import { SupportRoutes } from "../modules/support/support.route";
import { TransactionRoutes } from "../modules/transaction/transaction.route";
import { UploadRoutes } from "../modules/upload/upload.route";
import { UserRoutes } from "../modules/user/user.route";

const router = Router();

const moduleRoutes = [
  { path: "/auth", route: AuthRoutes },
  { path: "/user", route: UserRoutes },
  { path: "/otp", route: OtpRoutes },
  { path: "/upload", route: UploadRoutes },
  { path: "/plan", route: PlanRoutes },
  { path: "/credit", route: CreditRoutes },
  { path: "/card", route: CardRoutes },
  { path: "/analysis", route: AnalysisRoutes },
  { path: "/grading", route: GradingRoutes },
  { path: "/slab", route: SlabRoutes },
  { path: "/slab-order", route: SlabOrderRoutes },
  { path: "/cart", route: cartRoutes },
  { path: "/shippo", route: shippoRoutes },
  { path: "/collection", route: CollectionRoutes },
  { path: "/price", route: PriceRoutes },
  { path: "/subscription", route: SubscriptionRoutes },
  { path: "/transaction", route: TransactionRoutes },
  { path: "/dashboard", route: DashboardRoutes },
  { path: "/notification", route: NotificationRoutes },
  { path: "/support", route: SupportRoutes },
  { path: "/cms", route: CmsRoutes },
  { path: "/activity-log", route: ActivityLogRoutes },
];

moduleRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
