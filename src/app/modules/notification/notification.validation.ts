import z from "zod";

/** No create schema — ordinary notifications are minted server-side only, from
 *  platform events. The single exception is the admin broadcast below. */
export const updateNotificationSettingsZodSchema = z.object({
  inappEnabled: z.boolean().optional(),
  emailGradeReady: z.boolean().optional(),
  emailPriceAlert: z.boolean().optional(),
  emailSubscription: z.boolean().optional(),
  emailSupport: z.boolean().optional(),
  /** Staff only. A non-staff account may store it, but nothing reads it —
   *  staff-audience notifications are never written to a customer. */
  emailAdminAlerts: z.boolean().optional(),
});

/**
 * Admin announcement.
 *
 * Deliberately narrow: a title, an optional body, and an optional in-app path.
 * There is no `type` or `audience` field — both are fixed server-side to
 * `system`/`user`, so this route cannot be used to forge a "grade ready" or a
 * billing message, and cannot address the staff queue.
 */
export const broadcastNotificationZodSchema = z.object({
  title: z
    .string({ error: "Title must be string" })
    .trim()
    .min(3, { message: "Title must be at least 3 characters long." })
    .max(120, { message: "Title cannot exceed 120 characters." }),
  body: z
    .string({ error: "Body must be string" })
    .trim()
    .max(500, { message: "Body cannot exceed 500 characters." })
    .optional(),
  /** An in-app path, never an absolute URL — an announcement that can point at
   *  an external site is a phishing vector aimed at every user at once. */
  link: z
    .string({ error: "Link must be string" })
    .trim()
    .regex(/^\/[\w\-/?=&#.]*$/, {
      message: "Link must be an in-app path beginning with /",
    })
    .max(200)
    .optional(),
});
