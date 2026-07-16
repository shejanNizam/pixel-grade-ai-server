import z from "zod";

export const sendOtpZodSchema = z.object({
  email: z
    .string({ error: "Email must be a string" })
    .email({ message: "Invalid email address format." }),
});

export const verifyOtpZodSchema = z.object({
  email: z
    .string({ error: "Email must be a string" })
    .email({ message: "Invalid email address format." }),
  otp: z
    .string({ error: "OTP must be a string" })
    .length(6, { message: "OTP must be exactly 6 digits." })
    .regex(/^\d{6}$/, { message: "OTP must contain only digits." }),
});
