import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { NotifType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
import { UserRole } from "../user/user.interface";
import { ISupportTicket, TicketStatus } from "./support.interface";
import { SupportTicket, SupportTicketMessage } from "./support.model";

const createTicket = async (
  userId: string,
  payload: { subject: string; message: string },
) => {
  const ticket = await SupportTicket.create({
    user: userId,
    subject: payload.subject,
    status: TicketStatus.open,
  });

  await SupportTicketMessage.create({
    ticket: ticket._id,
    sender: userId,
    isAdmin: false,
    message: payload.message,
  });

  // Tell the staff queue. Before this, a new ticket notified nobody — it sat
  // in the admin list until someone thought to look.
  await NotificationServices.createForStaff(
    NotifType.support_ticket_new,
    "New support ticket",
    payload.subject,
    `/admin/support/${String(ticket._id)}`,
  );

  return ticket;
};

const getMyTickets = async (userId: string, query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<ISupportTicket>(
    SupportTicket.find({ user: userId }),
    query,
  );

  const tickets = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: tickets, meta };
};

const getAllTickets = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<ISupportTicket>(
    SupportTicket.find().populate("user", "name email avatar"),
    query,
  );

  const tickets = await queryBuilder
    .search(["subject"])
    .filter()
    .sort()
    .paginate()
    .build();
  const meta = await queryBuilder.getMeta();

  return { data: tickets, meta };
};

/**
 * Fetches a thread. Regular users may only open their own ticket; admins may
 * open any. The ownership check happens here rather than in a route guard
 * because the answer depends on the document, not just the role.
 */
const getTicket = async (ticketId: string, userId: string, role: string) => {
  const ticket = await SupportTicket.findById(ticketId).populate(
    "user",
    "name email avatar",
  );
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");

  const isStaff = role === UserRole.admin || role === UserRole.super_admin;
  if (!isStaff && String(ticket.user._id ?? ticket.user) !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
  }

  const messages = await SupportTicketMessage.find({ ticket: ticketId })
    .populate("sender", "name email avatar role")
    .sort({ createdAt: 1 });

  return { ticket, messages };
};

/**
 * Appends to a thread.
 *
 * `isAdmin` is derived from the sender's role at send time and stored on the
 * message, so a user later promoted to admin does not retroactively turn their
 * old messages into staff replies.
 *
 * A staff reply moves the ticket to `answered` and notifies the owner in real
 * time; a user reply reopens an answered ticket, so a follow-up question does
 * not sit unnoticed in a resolved queue.
 */
const addMessage = async (
  ticketId: string,
  senderId: string,
  role: string,
  message: string,
) => {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");

  const isStaff = role === UserRole.admin || role === UserRole.super_admin;
  if (!isStaff && String(ticket.user) !== senderId) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
  }

  if (ticket.status === TicketStatus.closed) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This ticket is closed. Open a new ticket to continue.",
    );
  }

  const created = await SupportTicketMessage.create({
    ticket: ticketId,
    sender: senderId,
    isAdmin: isStaff,
    message,
  });

  ticket.status = isStaff ? TicketStatus.answered : TicketStatus.open;
  await ticket.save();

  if (isStaff) {
    await NotificationServices.create(
      ticket.user,
      NotifType.support,
      "Support replied to your ticket",
      ticket.subject,
      `/user-dashboard/support/${ticketId}`,
    );
  } else {
    // A user reply reopens the ticket, so the staff queue has to hear about it
    // — otherwise a follow-up question sits unread in an "answered" thread.
    await NotificationServices.createForStaff(
      NotifType.support_ticket_reply,
      "User replied to a ticket",
      ticket.subject,
      `/admin/support/${ticketId}`,
    );
  }

  return created;
};

const updateStatus = async (ticketId: string, status: TicketStatus) => {
  const ticket = await SupportTicket.findByIdAndUpdate(
    ticketId,
    { status },
    { returnDocument: "after", runValidators: true },
  );
  if (!ticket) throw new AppError(httpStatus.NOT_FOUND, "Ticket not found");

  if (status === TicketStatus.resolved) {
    await NotificationServices.create(
      ticket.user,
      NotifType.support,
      "Your support ticket was resolved",
      ticket.subject,
    );
  }

  return ticket;
};

export const SupportServices = {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicket,
  addMessage,
  updateStatus,
};
