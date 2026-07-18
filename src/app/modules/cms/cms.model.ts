import { model, Schema } from "mongoose";
import { CmsSlug, ICmsPage } from "./cms.interface";

export const cmsPageSchema = new Schema<ICmsPage>(
  {
    slug: {
      type: String,
      enum: Object.values(CmsSlug),
      required: true,
      unique: true,
    },
    htmlContent: { type: String, default: "" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const CmsPage = model<ICmsPage>("CmsPage", cmsPageSchema);
