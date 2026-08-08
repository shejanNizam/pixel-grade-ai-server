import { deleteFromCloudinary } from "../app/config/cloudinary.config";
import { globalErrorHandler } from "../app/middlewares/globalErrorHandler";
import { Request, Response } from "express";

describe("Upload Error Handling & Cleanup Resilience", () => {
  it("deleteFromCloudinary should execute safely without throwing on invalid/undefined/null inputs", async () => {
    await expect(deleteFromCloudinary(undefined)).resolves.not.toThrow();
    await expect(deleteFromCloudinary(null as unknown as string)).resolves.not.toThrow();
    await expect(deleteFromCloudinary("")).resolves.not.toThrow();
    await expect(deleteFromCloudinary(123 as unknown as string)).resolves.not.toThrow();
    await expect(deleteFromCloudinary("invalid-url-without-upload")).resolves.not.toThrow();
  });

  it("globalErrorHandler should handle req.files with missing or undefined file paths gracefully without crashing the server process", async () => {
    const req = {
      file: undefined,
      files: [
        undefined,
        null,
        {},
        { path: undefined },
        { path: "" },
        { path: 123 },
      ] as unknown as Express.Multer.File[],
    } as unknown as Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    const next = jest.fn();
    const mockError = new Error("Multer upload aborted mid-stream");

    await expect(
      globalErrorHandler(mockError, req, res, next)
    ).resolves.not.toThrow();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Multer upload aborted mid-stream",
      })
    );
  });
});
