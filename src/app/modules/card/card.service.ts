import httpStatus from "http-status";
import AppError from "../../errorHelpers/AppError";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { ICard } from "./card.interface";
import { Card } from "./card.model";

/**
 * The catalogue is read-only over HTTP. Rows are written by the identification
 * pipeline, never by a client — there is deliberately no create, update, or
 * delete endpoint, since a hand-edited card would corrupt the pricing history
 * and every collection entry pointing at it.
 */

const getAllCards = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<ICard>(Card.find(), query);

  const cards = await queryBuilder
    .search(["name", "setExpansion", "cardNumber"])
    .filter()
    .sort()
    .paginate()
    .build();

  const meta = await queryBuilder.getMeta();
  return { data: cards, meta };
};

const getSingleCard = async (id: string) => {
  const card = await Card.findById(id);
  if (!card) throw new AppError(httpStatus.NOT_FOUND, "Card not found");
  return card;
};

/** Upsert by the identification service's id. Used by the identification
 *  pipeline so a card seen twice updates in place rather than duplicating. */
const upsertByScrydexId = async (payload: Partial<ICard>) => {
  if (!payload.scrydexCardId) {
    throw new AppError(httpStatus.BAD_REQUEST, "scrydexCardId is required");
  }

  return Card.findOneAndUpdate(
    { scrydexCardId: payload.scrydexCardId },
    { $set: payload },
    { returnDocument: "after", upsert: true, runValidators: true },
  );
};

/** Distinct set names, for the collection's "group by set" filter. */
const getSets = async () => {
  return Card.distinct("setExpansion");
};

export const CardServices = {
  getAllCards,
  getSingleCard,
  upsertByScrydexId,
  getSets,
};
