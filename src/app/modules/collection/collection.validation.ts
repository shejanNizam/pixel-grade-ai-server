import z from "zod";

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { message: "Must be a valid ObjectId." });

/**
 * Either path is valid: supply `report` for a scanned card (the card is then
 * read from the report), or `card` for a manual entry. `currentPrice` is absent
 * by design — price is system-owned and seeded from the catalogue.
 */
export const addCollectionItemZodSchema = z
  .object({
    card: objectId.optional(),
    report: objectId.optional(),
    manualImageUrl: z.string().url({ message: "Must be a valid URL." }).optional(),
    externalGrade: z.string().max(50).optional(),
    quantity: z.number().int().min(1).optional(),
    favorite: z.boolean().optional(),
  })
  .refine((data) => data.card ?? data.report, {
    message: "Provide either `card` (manual entry) or `report` (scanned card).",
    path: ["card"],
  });

export const updateCollectionItemZodSchema = z.object({
  quantity: z.number().int().min(1).optional(),
  favorite: z.boolean().optional(),
  externalGrade: z.string().max(50).optional(),
  manualImageUrl: z.string().url({ message: "Must be a valid URL." }).optional(),
});
