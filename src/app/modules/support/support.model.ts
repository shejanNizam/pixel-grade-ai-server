import { model, Schema } from "mongoose";
import {
  ISupportTicket,
  ISupportTicketMessage,
  TicketStatus,
} from "./support.interface";

export const supportTicketSchema = new Schema<ISupportTicket>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(TicketStatus),
      default: TicketStatus.open,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

supportTicketSchema.index({ user: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, updatedAt: -1 });

export const SupportTicket = model<ISupportTicket>(
  "SupportTicket",
  supportTicketSchema,
);

export const supportTicketMessageSchema = new Schema<ISupportTicketMessage>(
  {
    ticket: {
      type: Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isAdmin: { type: Boolean, default: false },
    message: { type: String, required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// A thread is always read oldest-first for one ticket.
supportTicketMessageSchema.index({ ticket: 1, createdAt: 1 });

export const SupportTicketMessage = model<ISupportTicketMessage>(
  "SupportTicketMessage",
  supportTicketMessageSchema,
);
