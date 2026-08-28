import { TGenericErrorResponse } from "../interfaces/error.types";

export const handlerDuplicateError = (err: { message: string }): TGenericErrorResponse => {
  const matchedArray = err.message.match(/"([^"]*)"/);

  return {
    statusCode: 400,
    message: `${matchedArray ? matchedArray[1] : "Entry"} already exists!!`,
  };
};
