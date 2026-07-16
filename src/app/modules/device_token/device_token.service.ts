import { IDeviceToken } from "./device_token.interface";
import { DeviceToken } from "./device_token.model";

const upsertToken = async (payload: Partial<IDeviceToken>) => {
  return DeviceToken.findOneAndUpdate(
    { token: payload.token },
    { ...payload, lastActiveAt: new Date() },
    { upsert: true, new: true, runValidators: true },
  );
};

const removeToken = async (token: string) => {
  return DeviceToken.findOneAndDelete({ token });
};

const getUserTokens = async (userId: string) => {
  return DeviceToken.find({ userId });
};

export const DeviceTokenServices = { upsertToken, removeToken, getUserTokens };
