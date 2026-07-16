import z from "zod";
import { UserRole } from "./user.interface";

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
  phone: z
    .string({ error: "Phone must be string" })
    .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format e.g. +8801712345678")
    .optional(),
  role: z.enum(Object.values(UserRole) as [string, ...string[]]).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  blockReason: z.string().optional(),
  isEmailVerified: z.boolean({ error: "isEmailVerified must be boolean" }).optional(),
  isDeleted: z.boolean({ error: "isDeleted must be boolean" }).optional(),
});
