import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { JwtPayload } from "jsonwebtoken";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { IUser, UserRole } from "./user.interface";
import { User } from "./user.model";

const createUser = async (payload: Partial<IUser>) => {
  const { email, password, ...rest } = payload;

  if (!email) throw new AppError(httpStatus.BAD_REQUEST, "Email is required!");

  const isUserExist = await User.findOne({ email });
  if (isUserExist) throw new AppError(httpStatus.BAD_REQUEST, "User already exists!");

  const hashPassword = await bcrypt.hash(
    password as string,
    Number(configs.bcrypt_salt_round),
  );

  const user = await User.create({ email, password: hashPassword, ...rest });
  const result = user.toObject();
  delete result.password;
  return result;
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

  const updatedUser = await User.findByIdAndUpdate(userId, payload, {
    returnDocument: "after",
    runValidators: true,
  });

  return updatedUser;
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
  return { data: users, meta };
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
