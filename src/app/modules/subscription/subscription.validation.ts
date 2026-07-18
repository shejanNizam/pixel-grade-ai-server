import z from "zod";
import { BillingInterval } from "./subscription.interface";

/** Nothing about price or status is accepted — both are derived from the plan
 *  and from verified Stripe events. */
export const createCheckoutZodSchema = z.object({
  planId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, { message: "Must be a valid ObjectId." }),
  interval: z.enum(Object.values(BillingInterval) as [string, ...string[]]),
});
