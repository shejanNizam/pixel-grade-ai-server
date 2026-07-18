import z from "zod";
import { CmsSlug } from "./cms.interface";

export const updateCmsPageZodSchema = z.object({
  htmlContent: z
    .string({ error: "htmlContent must be string" })
    .max(200_000, { message: "Page content is too large." }),
});

export const cmsSlugSchema = z.enum(
  Object.values(CmsSlug) as [string, ...string[]],
);
