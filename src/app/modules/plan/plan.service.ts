import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { IPlan } from "./plan.interface";
import { Plan } from "./plan.model";

/** Public — powers the marketing pricing table and the subscription screen.
 *  Ordered by price so the tiers always render cheapest-first. */
const getAllPlans = async () => {
  return Plan.find({ isActive: true }).sort({ priceMonthly: 1 });
};

/** Admin view includes deactivated tiers. */
const getAllPlansForAdmin = async () => {
  return Plan.find().sort({ priceMonthly: 1 });
};

const getSinglePlan = async (id: string) => {
  const plan = await Plan.findById(id);
  if (!plan) throw new AppError(httpStatus.NOT_FOUND, "Plan not found");
  return plan;
};

/**
 * Admin edit. The four tiers are fixed, so `name` is stripped even if it
 * survives validation — renaming a tier would orphan every subscription and
 * every wallet that resolved its allowance through it.
 */
const updatePlan = async (id: string, payload: Partial<IPlan>) => {
  const existing = await Plan.findById(id);
  if (!existing) throw new AppError(httpStatus.NOT_FOUND, "Plan not found");

  const safePayload: Partial<IPlan> = { ...payload };
  delete safePayload.name;
  delete safePayload._id;

  const updated = await Plan.findByIdAndUpdate(id, safePayload, {
    returnDocument: "after",
    runValidators: true,
  });

  return updated;
};

export const PlanServices = {
  getAllPlans,
  getAllPlansForAdmin,
  getSinglePlan,
  updatePlan,
};
