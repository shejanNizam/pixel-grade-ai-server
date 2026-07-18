import z from "zod";

/** There is deliberately no user-facing schema that grants credits. The only
 *  way credits enter a wallet is a scheduled grant, a refund, or this
 *  admin-guarded adjustment. */
export const adminAdjustCreditsZodSchema = z.object({
  amount: z
    .number({ error: "amount must be a number" })
    .int({ message: "Adjustment must be a whole number." })
    .refine((n) => n !== 0, { message: "Adjustment cannot be zero." }),
  note: z.string().max(280).optional(),
});
