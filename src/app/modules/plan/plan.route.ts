import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { PlanControllers } from "./plan.controller";
import { updatePlanZodSchema } from "./plan.validation";

const router = Router();

/**
 * @swagger
 * /plan:
 *   get:
 *     tags: [Plan]
 *     summary: List active subscription plans (public — powers the pricing page)
 *     responses:
 *       200:
 *         description: The four plan tiers, cheapest first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 */
router.get("/", PlanControllers.getAllPlans);

/**
 * @swagger
 * /plan/admin:
 *   get:
 *     tags: [Plan]
 *     summary: List all plans including deactivated ones (admin only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All plans
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/admin",
  checkAuth(UserRole.admin, UserRole.super_admin),
  PlanControllers.getAllPlansForAdmin,
);

/**
 * @swagger
 * /plan/{id}:
 *   get:
 *     tags: [Plan]
 *     summary: Get a single plan
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan found
 *       404:
 *         description: Plan not found
 *   patch:
 *     tags: [Plan]
 *     summary: Edit a plan (admin only)
 *     description: >
 *       Plans are edit-only. There is no create or delete endpoint — the four
 *       tiers are fixed — and `name` is rejected so a tier cannot be renamed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Plan updated
 *       403:
 *         description: Forbidden — insufficient role
 *       404:
 *         description: Plan not found
 */
router.get("/:id", PlanControllers.getSinglePlan);

router.patch(
  "/:id",
  checkAuth(UserRole.admin, UserRole.super_admin),
  validateRequest(updatePlanZodSchema),
  PlanControllers.updatePlan,
);

export const PlanRoutes = router;
