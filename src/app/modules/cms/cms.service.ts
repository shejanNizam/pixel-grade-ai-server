import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { CmsSlug } from "./cms.interface";
import { CmsPage } from "./cms.model";

/** Public read. Pages are seeded on boot, so a missing row means the seeder did
 *  not run rather than a bad request — surfaced as 404 either way. */
const getPage = async (slug: CmsSlug) => {
  const page = await CmsPage.findOne({ slug });
  if (!page) throw new AppError(httpStatus.NOT_FOUND, "Page not found");
  return page;
};

const getAllPages = async () => {
  return CmsPage.find().populate("updatedBy", "name email");
};

/**
 * Admin edit. Upserts so a page missing from the seed still saves rather than
 * failing, and always stamps who made the change — the client asked to track
 * who edited each page and when.
 */
const updatePage = async (
  slug: CmsSlug,
  htmlContent: string,
  adminId: string,
) => {
  return CmsPage.findOneAndUpdate(
    { slug },
    { htmlContent, updatedBy: adminId },
    { returnDocument: "after", upsert: true, runValidators: true },
  );
};

export const CmsServices = {
  getPage,
  getAllPages,
  updatePage,
};
