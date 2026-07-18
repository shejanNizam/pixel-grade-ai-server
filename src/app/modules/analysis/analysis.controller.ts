import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ImageSide, UploadSource } from "./analysis.interface";
import { AnalysisServices, UploadedImage } from "./analysis.service";
import { CardGame } from "../card/card.interface";

const createAnalysis = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;

  // Defaults are applied here rather than in the schema so the service always
  // receives a fully-populated image set.
  const images: UploadedImage[] = (
    req.body.images as Partial<UploadedImage>[]
  ).map((image, index) => ({
    imageUrl: image.imageUrl as string,
    side: (image.side as ImageSide) ?? ImageSide.front,
    slotIndex: image.slotIndex ?? index,
  }));

  const result = await AnalysisServices.createAnalysis(userId as string, {
    source: (req.body.source as UploadSource) ?? UploadSource.standard,
    game: (req.body.game as CardGame) ?? CardGame.pokemon,
    language: req.body.language,
    images,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Scan started — confirm the card match to continue.",
    data: result,
  });
});

const confirmCard = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await AnalysisServices.confirmCard(
    userId as string,
    req.params.id as string,
    req.body.cardId,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Card confirmed — grading can now begin.",
    data: result,
  });
});

const getMyAnalyses = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await AnalysisServices.getMyAnalyses(
    userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Scans retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getAnalysis = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await AnalysisServices.getAnalysis(
    userId as string,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Scan retrieved successfully!",
    data: result,
  });
});

export const AnalysisControllers = {
  createAnalysis,
  confirmCard,
  getMyAnalyses,
  getAnalysis,
};
