import crypto from "crypto";
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { cloudinaryUpload } from "./cloudinary.config";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = new CloudinaryStorage({
  cloudinary: cloudinaryUpload,
  params: async (_req: Express.Request, file: Express.Multer.File) => {
    const baseName = file.originalname
      .toLowerCase()
      .replace(/\.[^.]+$/, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 60);

    return {
      folder: "uploads",
      resource_type: "auto",
      public_id: `${crypto.randomUUID()}-${baseName}`,
    };
  },
});

export const multerUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});
