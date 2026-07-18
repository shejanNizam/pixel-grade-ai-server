import z from "zod";
import { SLAB_STYLES } from "../../constants";

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { message: "Must be a valid ObjectId." });

/** Dimensions are deliberately absent — geometry is server-owned and comes from
 *  the schema defaults, so a client cannot resize the card window. */
export const createSlabLabelZodSchema = z.object({
  reportId: objectId,
  styleId: z.enum(SLAB_STYLES as unknown as [string, ...string[]]).optional(),
});

export const regenerateSlabZodSchema = z.object({
  styleId: z.enum(SLAB_STYLES as unknown as [string, ...string[]]).optional(),
});
