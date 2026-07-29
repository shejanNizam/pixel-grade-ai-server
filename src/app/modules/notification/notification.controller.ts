import { Request, Response } from "express";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { NotificationServices } from "./notification.service";

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
  // Role comes from the verified token, never from the query — `audience` is
  // authorised against it inside the service.
  const { _id: userId, role } = req.user as JwtPayload;
  const result = await NotificationServices.getMyNotifications(
    userId as string,
    role as string | undefined,
    req.query as unknown as Record<string, string>,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notifications retrieved successfully!",
    data: result.data,
    meta: result.meta,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId, role } = req.user as JwtPayload;
  const result = await NotificationServices.getUnreadCount(
    userId as string,
    role as string | undefined,
    req.query.audience as string | undefined,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Unread count retrieved successfully!",
    data: result,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await NotificationServices.markAsRead(
    userId as string,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification marked as read!",
    data: result,
  });
});

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId, role } = req.user as JwtPayload;
  const result = await NotificationServices.markAllAsRead(
    userId as string,
    role as string | undefined,
    (req.query.audience ?? req.body?.audience) as string | undefined,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All notifications marked as read!",
    data: result,
  });
});

const remove = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  await NotificationServices.remove(userId as string, req.params.id as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification deleted successfully!",
    data: null,
  });
});

const getSettings = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await NotificationServices.getSettings(userId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification settings retrieved successfully!",
    data: result,
  });
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const { _id: userId } = req.user as JwtPayload;
  const result = await NotificationServices.updateSettings(
    userId as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification settings updated successfully!",
    data: result,
  });
});

/** Admin announcement to every active customer. Guarded at the route. */
const broadcast = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationServices.broadcast(
    req.body.title,
    req.body.body,
    req.body.link,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Announcement sent to ${result.delivered} of ${result.recipients} users.`,
    data: result,
  });
});

export const NotificationControllers = {
  getMyNotifications,
  broadcast,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  remove,
  getSettings,
  updateSettings,
};
