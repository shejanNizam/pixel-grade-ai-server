import z from "zod";
import { TicketStatus } from "./support.interface";

export const createTicketZodSchema = z.object({
  subject: z
    .string({ error: "Subject must be string" })
    .min(3, { message: "Subject must be at least 3 characters long." })
    .max(150, { message: "Subject cannot exceed 150 characters." }),
  message: z
    .string({ error: "Message must be string" })
    .min(1, { message: "Message cannot be empty." })
    .max(5000, { message: "Message cannot exceed 5000 characters." }),
});

export const addTicketMessageZodSchema = z.object({
  message: z
    .string({ error: "Message must be string" })
    .min(1, { message: "Message cannot be empty." })
    .max(5000, { message: "Message cannot exceed 5000 characters." }),
});

export const updateTicketStatusZodSchema = z.object({
  status: z.enum(Object.values(TicketStatus) as [string, ...string[]]),
});
