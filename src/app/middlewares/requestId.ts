import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

export const requestId = (req: Request, res: Response, next: NextFunction) => {
  req.id = (req.headers["x-request-id"] as string) ?? randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
};
