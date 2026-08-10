import { Document, Types } from "mongoose";

export enum TicketStatus {
  open = "open",
  answered = "answered",
  resolved = "resolved",
  closed = "closed",
}

/** Retained indefinitely. */
export interface ISupportTicketInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  subject: string;
  status: TicketStatus;
  reopenCount?: number;
}

export type ISupportTicket = ISupportTicketInitial & Document;

export interface ISupportTicketMessageInitial {
  _id?: Types.ObjectId;
  ticket: Types.ObjectId;
  sender: Types.ObjectId;
  /** Denormalised from the sender's role at send time. A user later promoted to
   *  admin must not retroactively turn their old messages into staff replies. */
  isAdmin: boolean;
  message: string;
}

export type ISupportTicketMessage = ISupportTicketMessageInitial & Document;
