/* eslint-disable @typescript-eslint/no-explicit-any */
import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import { configs } from "./index";
import AppError from "../errorHelpers/AppError";

cloudinary.config({
  cloud_name: configs.CLOUDINARY.cloudinary_cloud_name,
  api_key: configs.CLOUDINARY.cloudinary_api_key,
  api_secret: configs.CLOUDINARY.cloudinary_api_secret,
});

export const uploadBufferToCloudinary = async (
  buffer: Buffer,
  fileName: string,
): Promise<UploadApiResponse | undefined> => {
  try {
    return new Promise((resolve, reject) => {
      const public_id = `uploads/${fileName}-${Date.now()}`;
      cloudinary.uploader
        .upload_stream(
          { resource_type: "auto", public_id, folder: "uploads" },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          },
        )
        .end(buffer);
    });
  } catch (error: any) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Error uploading file: ${error.message}`,
    );
  }
};

// Extracts public_id from a Cloudinary URL.
// e.g. https://res.cloudinary.com/xxx/image/upload/v123/folder/image.jpg → folder/image
const extractPublicId = (url: string): string | null => {
  const parts = url.split("/upload/");
  if (parts.length < 2) return null;
  const withoutVersion = (parts[1] ?? "").replace(/^v\d+\//, "");
  return withoutVersion.replace(/\.[^.]+$/, "");
};

export const deleteFromCloudinary = async (url: string): Promise<void> => {
  try {
    const public_id = extractPublicId(url);
    if (!public_id) return;
    await cloudinary.uploader.destroy(public_id, { resource_type: "auto" });
  } catch (error: any) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `Cloudinary deletion failed: ${error.message}`,
    );
  }
};

export const cloudinaryUpload = cloudinary;
