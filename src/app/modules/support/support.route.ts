import { Router } from "express";
import { checkAuth } from "../../middlewares/checkAuth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "../user/user.interface";
import { SupportControllers } from "./support.controller";
import {
  addTicketMessageZodSchema,
  createTicketZodSchema,
  updateTicketStatusZodSchema,
} from "./support.validation";

const router = Router();
const anyUser = Object.values(UserRole);

/**
 * @swagger
 * /support:
 *   post:
 *     tags: [Support]
 *     summary: Open a support ticket
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Ticket created
 *       422:
 *         description: Validation error
 *   get:
 *     tags: [Support]
 *     summary: List the caller's own tickets
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tickets
 */
router.post(
  "/",
  checkAuth(...anyUser),
  validateRequest(createTicketZodSchema),
  SupportControllers.createTicket,
);

router.get("/", checkAuth(...anyUser), SupportControllers.getMyTickets);

/**
 * @swagger
 * /support/all:
 *   get:
 *     tags: [Support]
 *     summary: List every ticket (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, answered, resolved, closed]
 *     responses:
 *       200:
 *         description: Tickets
 *       403:
 *         description: Forbidden — insufficient role
 */
router.get(
  "/all",
  checkAuth(UserRole.admin, UserRole.super_admin),
  SupportControllers.getAllTickets,
);

/**
 * @swagger
 * /support/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get a ticket with its full message thread
 *     description: >
 *       Users may only open their own tickets; admins may open any. Ownership is
 *       checked against the document, not the role alone.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ticket and messages
 *       403:
 *         description: Not your ticket
 *       404:
 *         description: Ticket not found
 */
router.get("/:id", checkAuth(...anyUser), SupportControllers.getTicket);

/**
 * @swagger
 * /support/{id}/message:
 *   post:
 *     tags: [Support]
 *     summary: Reply on a ticket
 *     description: >
 *       A staff reply moves the ticket to `answered` and notifies the owner.
 *       A user reply reopens an answered ticket. Closed tickets reject replies.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Message added
 *       400:
 *         description: Ticket is closed
 *       403:
 *         description: Not your ticket
 */
router.post(
  "/:id/message",
  checkAuth(...anyUser),
  validateRequest(addTicketMessageZodSchema),
  SupportControllers.addMessage,
);

/**
 * @swagger
 * /support/{id}/status:
 *   patch:
 *     tags: [Support]
 *     summary: Change a ticket's status (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status updated
 *       403:
 *         description: Forbidden — insufficient role
 */
router.patch(
  "/:id/status",
  checkAuth(UserRole.admin, UserRole.super_admin),
  validateRequest(updateTicketStatusZodSchema),
  SupportControllers.updateStatus,
);

router.patch(
  "/:id/reopen",
  checkAuth(...anyUser),
  SupportControllers.reopenTicket,
);

export const SupportRoutes = router;
