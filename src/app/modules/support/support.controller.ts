import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { TicketStatus } from "./support.interface";
import { SupportServices } from "./support.service";

const createTicket = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SupportServices.createTicket(userId as string, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Support ticket created successfully!",
    data: result,
  });
});

const getMyTickets = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await SupportServices.getMyTickets(
    userId as string,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tickets retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getAllTickets = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportServices.getAllTickets(
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tickets retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getTicket = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId, role } = req.user as JwtPayload;
  const result = await SupportServices.getTicket(
    req.params.id as string,
    userId as string,
    role as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Ticket retrieved successfully!",
    data: result,
  });
});

const addMessage = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId, role } = req.user as JwtPayload;
  const result = await SupportServices.addMessage(
    req.params.id as string,
    userId as string,
    role as string,
    req.body.message,
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Message sent successfully!",
    data: result,
  });
});

const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportServices.updateStatus(
    req.params.id as string,
    req.body.status as TicketStatus,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Ticket status updated successfully!",
    data: result,
  });
});

export const SupportControllers = {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicket,
  addMessage,
  updateStatus,
};
