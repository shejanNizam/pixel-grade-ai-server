import { Request } from "express";
import { Types } from "mongoose";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { logger } from "../../utils/logger";
import { ActivityAction, IActivityLog } from "./activity_log.interface";
import { ActivityLog } from "./activity_log.model";

/**
 * Audit trail. Retained a minimum of one year.
 *
 * Logging is best-effort by design: an audit write must never be the reason a
 * user-facing action fails, so failures here are logged and swallowed rather
 * than thrown. The tradeoff is deliberate — losing one audit row is preferable
 * to failing a grade the user already paid credits for.
 */
const record = async (
  action: ActivityAction,
  options: {
    userId?: string | Types.ObjectId | null;
    meta?: Record<string, unknown>;
    ipAddress?: string;
  } = {},
) => {
  try {
    await ActivityLog.create({
      action,
      ...(options.userId ? { user: options.userId } : {}),
      ...(options.meta ? { meta: options.meta } : {}),
      ...(options.ipAddress ? { ipAddress: options.ipAddress } : {}),
    });
  } catch (error) {
    logger.error("Failed to write activity log", { action, error });
  }
};

/** Convenience wrapper that pulls the caller's identity and IP off the request.
 *  `req.user` is absent on failed logins, which is exactly when the IP matters
 *  most — hence the optional user. */
const recordFromRequest = async (
  req: Request,
  action: ActivityAction,
  meta?: Record<string, unknown>,
) => {
  const userId = (req.user as { _id?: string } | undefined)?._id;
  await record(action, {
    userId,
    meta,
    ipAddress: req.ip,
  });
};

const getAllLogs = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<IActivityLog>(
    ActivityLog.find().populate("user", "name email role"),
    query,
  );

  const logs = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: logs, meta };
};

export const ActivityLogServices = {
  record,
  recordFromRequest,
  getAllLogs,
};
