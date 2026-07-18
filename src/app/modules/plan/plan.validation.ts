import z from "zod";
import { CreditInterval } from "./plan.interface";

/** Edit-only by design. There is no create schema and no delete route — the four
 *  tiers are fixed, so `name` is deliberately absent here and cannot be changed. */
export const updatePlanZodSchema = z.object({
  tagline: z.string().max(120).optional(),
  priceMonthly: z
    .number({ error: "priceMonthly must be a number" })
    .min(0, { message: "Price cannot be negative." })
    .optional(),
  priceYearly: z
    .number({ error: "priceYearly must be a number" })
    .min(0, { message: "Price cannot be negative." })
    .optional(),
  // `null` is a valid value meaning unlimited, so nullable() is load-bearing —
  // dropping it would make Enterprise un-editable.
  creditAmount: z
    .number({ error: "creditAmount must be a number" })
    .int({ message: "Credits must be a whole number." })
    .min(0, { message: "Credits cannot be negative." })
    .nullable()
    .optional(),
  creditInterval: z.enum(Object.values(CreditInterval) as [string, ...string[]]).optional(),
  pixelscope: z.boolean().optional(),
  priceTracking: z.boolean().optional(),
  watermarkReports: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  stripePriceIdMonth: z.string().optional(),
  stripePriceIdYear: z.string().optional(),
});
