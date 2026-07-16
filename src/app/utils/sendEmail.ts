/* eslint-disable @typescript-eslint/no-explicit-any */
import ejs from "ejs";
import nodemailer from "nodemailer";
import path from "path";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { logger } from "./logger";

const smtpPort = Number.parseInt(configs.EMAIL_SENDER.smtp_port || "587", 10);
const smtpSecure = smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: configs.EMAIL_SENDER.smtp_host,
  port: smtpPort,
  secure: smtpSecure,
  requireTLS: !smtpSecure,
  auth: {
    user: configs.EMAIL_SENDER.smtp_user,
    pass: configs.EMAIL_SENDER.smtp_pass,
  },
});

interface SendEmailOptions {
  to: string;
  subject: string;
  templateName: string;
  templateData?: Record<string, any>;
  attachments?: {
    filename: string;
    content: Buffer | string;
    contentType: string;
  }[];
}

export const sendEmail = async ({
  to,
  subject,
  templateName,
  templateData,
  attachments,
}: SendEmailOptions) => {
  try {
    const templatePath = path.join(
      __dirname,
      "templates",
      `${templateName}.ejs`,
    );
    const html = await ejs.renderFile(templatePath, templateData);
    const info = await transporter.sendMail({
      from: configs.EMAIL_SENDER.smtp_from || configs.EMAIL_SENDER.smtp_user,
      to: to,
      subject: subject,
      html: html,
      attachments: attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
      })),
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
  } catch (error: any) {
    logger.error("Email sending error", {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
    });
    throw new AppError(502, "Email not sent");
  }
};
