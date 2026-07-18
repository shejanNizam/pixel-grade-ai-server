import z from "zod";

/** No create schema — notifications are minted server-side only. */
export const updateNotificationSettingsZodSchema = z.object({
  inappEnabled: z.boolean().optional(),
  emailGradeReady: z.boolean().optional(),
  emailPriceAlert: z.boolean().optional(),
  emailSubscription: z.boolean().optional(),
  emailSupport: z.boolean().optional(),
});
