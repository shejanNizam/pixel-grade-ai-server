import z from "zod";
import { UserRole } from "./user.interface";

/** Shared so create and update cannot drift into two different rules. */
const usernameSchema = z
  .string({ error: "Username must be string" })
  .trim()
  .toLowerCase()
  .min(3, { message: "Username must be at least 3 characters long." })
  .max(24, { message: "Username cannot exceed 24 characters." })
  .regex(/^[a-z0-9_]+$/, {
    message:
      "Username may only contain letters, numbers, and underscores — no spaces or symbols.",
  });

export const createUserZodSchema = z.object({
  name: z
    .string({ error: "Name must be string" })
    .min(2, { message: "Name must be at least 2 characters long." })
    .max(50, { message: "Name cannot exceed 50 characters." }),
  email: z
    .string({ error: "Email must be string" })
    .email({ message: "Invalid email address format." }),
  password: z
    .string({ error: "Password must be string" })
    .min(8, { message: "Password must be at least 8 characters long." })
    .regex(/^(?=.*[A-Z])/, { message: "Password must contain at least 1 uppercase letter." })
    .regex(/^(?=.*[!@#$%^&*])/, { message: "Password must contain at least 1 special character." })
    .regex(/^(?=.*\d)/, { message: "Password must contain at least 1 number." }),
  // REQUIRED at sign-up (client, UI Feedback v1 edit #2): the username is the
  // public Creator Profile handle, so an account without one has a profile page
  // that cannot be addressed. Google sign-ups never reach this schema — passport
  // derives a handle instead (see UserServices.generateUniqueUsername).
  //
  // Accounts created before this stay valid: the field is still optional on the
  // model, and `updateUserZodSchema` below is what they use to fill it in.
  username: usernameSchema,
  phone: z
    .string({ error: "Phone must be string" })
    .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format e.g. +8801712345678")
    .optional(),
  role: z.enum([UserRole.user]).optional(),
});

export const updateUserZodSchema = z.object({
  name: z
    .string({ error: "Name must be string" })
    .min(2, { message: "Name must be at least 2 characters long." })
    .max(50, { message: "Name cannot exceed 50 characters." })
    .optional(),
  username: usernameSchema.optional(),
  phone: z
    .string({ error: "Phone must be string" })
    .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format e.g. +8801712345678")
    .optional(),
  // The two-step avatar flow: the file goes to POST /upload first, then the
  // resulting Cloudinary object is PATCHed here.
  avatar: z
    .object({
      url: z.string().url({ message: "avatar.url must be a valid URL" }),
      publicId: z.string().min(1),
    })
    .optional(),
  role: z.enum(Object.values(UserRole) as [string, ...string[]]).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  blockReason: z.string().optional(),
  isEmailVerified: z.boolean({ error: "isEmailVerified must be boolean" }).optional(),
  isDeleted: z.boolean({ error: "isDeleted must be boolean" }).optional(),
});
