import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { SubStatus } from "../subscription/subscription.interface";
import { Subscription } from "../subscription/subscription.model";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { logger } from "../../utils/logger";
import { OTPService } from "../otp/otp.service";
import { IUser, UserRole } from "./user.interface";
import { User } from "./user.model";

/** Mongo's unique-index violation, narrowed to the username key. */
const isDuplicateUsername = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: number }).code === 11000 &&
  "username" in ((error as { keyPattern?: object }).keyPattern ?? {});

/**
 * Rejects a taken username before the write, so the caller gets a 409 with a
 * usable message instead of a duplicate-key error. The unique index is still
 * the real guarantee — this is only for the error message.
 */
const assertUsernameAvailable = async (
  username: string,
  excludeUserId?: string,
) => {
  const normalised = username.trim().toLowerCase();
  const existing = await User.findOne({ username: normalised });

  if (existing && String(existing._id) !== excludeUserId) {
    throw new AppError(
      httpStatus.CONFLICT,
      "That username is already taken. Please choose another.",
    );
  }
};

const createUser = async (payload: Partial<IUser>) => {
  const { email, password, ...rest } = payload;

  if (!email) throw new AppError(httpStatus.BAD_REQUEST, "Email is required!");

  const isUserExist = await User.findOne({ email });
  if (isUserExist) {
    throw new AppError(
      httpStatus.CONFLICT,
      "An account with this email already exists. Try signing in instead.",
    );
  }

  if (rest.username) await assertUsernameAvailable(rest.username);

  const hashPassword = await bcrypt.hash(
    password as string,
    Number(configs.bcrypt_salt_round),
  );

  const user = await User.create({ email, password: hashPassword, ...rest });

  // Send the verification OTP here rather than leaving it to the client.
  //
  // Prototype V1 relied on the frontend firing POST /otp/send as a second call
  // after register; when that call failed the signup still reported success and
  // no email ever arrived — the "verification email is not sent" report. Owning
  // it server-side means an account cannot exist in a state where nobody has
  // been asked to verify it.
  //
  // A send failure must not roll back the account: the user exists, they simply
  // need to hit "resend". Surfacing it as `verificationEmailSent: false` lets
  // the client say so honestly instead of pretending an email is on its way.
  let verificationEmailSent = true;
  try {
    await OTPService.sendOTP(email);
  } catch (error) {
    verificationEmailSent = false;
    logger.error("Verification email failed to send on registration", {
      email,
      error,
    });
  }

  const result = user.toObject();
  delete result.password;
  return { ...result, verificationEmailSent };
};

const updateUser = async (
  userId: string,
  payload: Partial<IUser>,
  decodedToken: JwtPayload,
) => {
  const isRegularUser = decodedToken.role === UserRole.user;

  if (isRegularUser && userId !== decodedToken._id) {
    throw new AppError(httpStatus.UNAUTHORIZED, "You are not authorized");
  }

  const existingUser = await User.findById(userId);
  if (!existingUser) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (
    decodedToken.role === UserRole.admin &&
    existingUser.role === UserRole.super_admin
  ) {
    throw new AppError(httpStatus.UNAUTHORIZED, "You are not authorized");
  }

  if (payload.role && isRegularUser) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized to change role");
  }

  if (
    (payload.status || payload.isDeleted || payload.isEmailVerified) &&
    isRegularUser
  ) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
  }

  if (payload.username) {
    await assertUsernameAvailable(payload.username, userId);
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(userId, payload, {
      returnDocument: "after",
      runValidators: true,
    });

    return updatedUser;
  } catch (error) {
    // The pre-check above narrows the race window but cannot close it — two
    // requests can both pass it and only one can win the unique index. Turn
    // the resulting E11000 into the same message the pre-check gives, so the
    // user sees "taken" rather than a raw Mongo error.
    if (isDuplicateUsername(error)) {
      throw new AppError(
        httpStatus.CONFLICT,
        "That username is already taken. Please choose another.",
      );
    }
    throw error;
  }
};

const getAllUsers = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder(User.find({ isDeleted: false }), query);

  const users = await queryBuilder
    .search(["name", "email"])
    .filter()
    .sort()
    .paginate()
    .build();

  const meta = await queryBuilder.getMeta();

  // Attach each user's current plan. "Subscribed" is a fact about a
  // subscription, not a column on the account, so join it in for just the page
  // of users being returned — no active subscription means the implicit Free
  // plan. One extra query for the whole page, not one per row.
  const ids = users.map((u) => u._id);
  const subs = await Subscription.find({
    user: { $in: ids },
    status: SubStatus.active,
  }).populate("plan", "name");

  const planByUser = new Map(
    subs.map((s) => [
      String(s.user),
      (s.plan as unknown as { name?: string })?.name ?? null,
    ]),
  );

  const data = users.map((u) => ({
    ...u.toObject(),
    currentPlan: planByUser.get(String(u._id)) ?? "Free",
  }));

  return { data, meta };
};

const getSingleUser = async (id: string) => {
  const user = await User.findOne({ _id: id, isDeleted: false });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  return user;
};

const getMe = async (id: string) => {
  const user = await User.findOne({ _id: id, isDeleted: false });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  return user;
};

const deleteUser = async (userId: string) => {
  const user = await User.findByIdAndUpdate(
    userId,
    { isDeleted: true, deletedAt: new Date() },
    { returnDocument: "after" },
  );
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  return user;
};

const deleteMe = async (userId: string) => {
  const user = await User.findOneAndUpdate(
    { _id: userId, isDeleted: false },
    { isDeleted: true, deletedAt: new Date() },
    { returnDocument: "after" },
  );
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");
  return user;
};

export const UserServices = {
  createUser,
  updateUser,
  getAllUsers,
  getSingleUser,
  getMe,
  deleteUser,
  deleteMe,
};
