import httpStatus from "http-status";
import AppError from "../errorHelpers/AppError";
import { CardGame } from "../modules/card/card.interface";
import {
  isConfigured as scrydexIsConfigured,
  request,
} from "./scrydex/scrydex.client";
import { requireVisionSlug } from "./scrydex/scrydex.games";
import { toIdentifiedCards, type IdentifiedCard } from "./scrydex/scrydex.mapper";
import type { ScrydexVisionResponse } from "./scrydex/scrydex.types";
import { ScrydexMock } from "./scrydex.mock";

/**
 * Card identification — Scrydex Vision.
 *
 *   POST {base}/vision/v1/cards/identify
 *   Body: { image_url, games: ["pokemon"] }
 *
 * Auth, timeouts, and error mapping live in `scrydex/scrydex.client.ts`; the
 * game slug comes from `scrydex/scrydex.games.ts`, which is what makes adding a
 * TCG a one-row change. This file is only the Vision-specific parts.
 *
 * COST: each Vision call costs 5 Scrydex credits, a different currency from our
 * own 10-credits-per-scan. Identification therefore sends exactly ONE image,
 * not the whole PixelScope set — sending 20 would cost 100 Scrydex credits for
 * a single scan and would not improve the match.
 *
 * ⚠️ Failed Vision calls are still billed. A 401 from Vision was observed
 * consuming its full 5 credits on 2026-07-31, so the client below does not
 * retry: a blind retry on a timeout spends another 5 on a request that may
 * already have succeeded vendor-side.
 */

export type { IdentifiedCard };

/** Present when the photographed card is already in a third-party slab. */
export interface GradedDetails {
  company?: string;
  gradeLabel?: string;
  gradeNumber?: string;
  year?: string;
  cert?: string;
}

export interface IdentificationResult {
  candidates: IdentifiedCard[];
  languageCode?: string;
  /** Maps onto `collection_items.externalGrade` — a card that is already PSA 9
   *  should not have that fact discarded just because we also AI-grade it. */
  gradedDetails?: GradedDetails;
}

/**
 * Credentials present. Note that this is NOT the same as "Vision will work".
 *
 * Vision is separately entitled: the client's Starter-tier credentials read the
 * catalogue and pricing fine but are rejected by `/vision/v1/cards/identify`
 * with `{"error":"You do not have access to this endpoint"}` (verified
 * 2026-07-31), even though Scrydex's pricing page lists Vision on every tier.
 * There is no endpoint that reports entitlement, so the only way to learn this
 * is to call and read the 401 body — which `toAppError` puts in the message
 * verbatim for exactly that reason.
 */
const isConfigured = (): boolean =>
  ScrydexMock.visionEnabled() || scrydexIsConfigured();

/**
 * Identifies the card in a single image.
 *
 * Takes the whole set for signature compatibility but deliberately sends only
 * the first image — see the cost note in the file header.
 */
const identify = async (
  imageUrls: string[],
  game: CardGame,
): Promise<IdentificationResult> => {
  if (ScrydexMock.visionEnabled()) return ScrydexMock.identify(game);

  if (!imageUrls.length) {
    throw new AppError(httpStatus.BAD_REQUEST, "No image to identify.");
  }

  const games = [requireVisionSlug(game)];
  const maxAttempts = Math.min(imageUrls.length, 3);
  let lastResult: IdentificationResult = { candidates: [] };

  for (let i = 0; i < maxAttempts; i++) {
    const imageUrl = imageUrls[i];
    try {
      const payload = await request<ScrydexVisionResponse>(
        "/vision/v1/cards/identify",
        {
          method: "POST",
          body: { image_url: imageUrl, games },
          vision: true,
          operation: "Card identification",
        },
      );

      const analysis = payload.data?.analysis;
      const candidates = toIdentifiedCards(
        payload.data?.matches ?? [],
        game,
        analysis?.language_code,
      );

      const graded = analysis?.graded_details;
      lastResult = {
        candidates,
        languageCode: analysis?.language_code,
        gradedDetails: graded?.company
          ? {
              company: graded.company,
              gradeLabel: graded.grade_label,
              gradeNumber: graded.grade_number,
              year: graded.year,
              cert: graded.cert,
            }
          : undefined,
      };

      if (candidates.length > 0) {
        return lastResult;
      }
    } catch (err) {
      if (i === maxAttempts - 1 && lastResult.candidates.length === 0) {
        throw err;
      }
    }
  }

  return lastResult;
};

export const IdentificationProvider = {
  identify,
  isConfigured,
};
