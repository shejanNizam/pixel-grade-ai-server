import z from "zod";
import { EXT_ART_COUNT } from "../../services/imagegen.provider";

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { message: "Must be a valid ObjectId." });

/** Dimensions are deliberately absent — geometry is server-owned and comes from
 *  the schema defaults, so a client cannot resize the card window.
 *
 *  `styleId` is gone too: artwork is derived from the confirmed card rather
 *  than chosen from a fixed theme list (client, 2026-07-30). */
export const createSlabLabelZodSchema = z.object({
  reportId: objectId,
});

/** Regeneration takes no input — it always produces a fresh set of four. */
export const regenerateSlabZodSchema = z.object({});

export const selectSlabVariantZodSchema = z.object({
  variantIndex: z
    .number({ error: "variantIndex must be a number" })
    .int({ message: "variantIndex must be a whole number" })
    .min(1, { message: "variantIndex starts at 1" })
    .max(EXT_ART_COUNT, {
      message: `There are only ${EXT_ART_COUNT} artwork options`,
    }),
});
