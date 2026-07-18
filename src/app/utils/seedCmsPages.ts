import { CmsSlug } from "../modules/cms/cms.interface";
import { CmsPage } from "../modules/cms/cms.model";
import { logger } from "./logger";

/**
 * Creates the three public pages as empty shells so the admin editor and the
 * public routes both have a row to work with from day one.
 *
 * Content is deliberately left blank rather than filled with placeholder copy —
 * "no placeholder content anywhere" is an acceptance criterion, and a real
 * empty page is easier to spot than convincing filler.
 */
export const seedCmsPages = async () => {
  try {
    for (const slug of Object.values(CmsSlug)) {
      const exists = await CmsPage.findOne({ slug });
      if (exists) continue;

      await CmsPage.create({ slug, htmlContent: "" });
      logger.info(`Seeded CMS page: ${slug}`);
    }
  } catch (error) {
    logger.error("Failed to seed CMS pages", { error });
  }
};
