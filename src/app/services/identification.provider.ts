import httpStatus from "http-status";
import { configs } from "../config/index";
import AppError from "../errorHelpers/AppError";
import { CardGame } from "../modules/card/card.interface";

/**
 * Card identification — Scrydex Vision.
 *
 *   POST {base}/vision/v1/cards/identify
 *   Headers: X-Api-Key, X-Team-ID   (both required — one alone returns 401)
 *   Body:    { image_url, games: ["pokemon"] }
 *
 * Docs: https://scrydex.com/docs/vision/overview
 *
 * COST NOTE: each Vision call costs 5 Scrydex credits, which is a different
 * currency from our own 10-credits-per-scan. Identification therefore sends
 * exactly ONE image (see `identify`), not the whole PixelScope set — sending 20
 * would cost 100 Scrydex credits for a single scan we charge 10 app credits for,
 * and would not improve the match.
 */

/** Scrydex's own game slugs. Ours differ, so map rather than assume. */
const GAME_SLUG: Record<CardGame, string> = {
  [CardGame.pokemon]: "pokemon",
  [CardGame.magic]: "magicthegathering",
  [CardGame.yugioh]: "yugioh",
  [CardGame.sports]: "sports",
};

export interface IdentifiedCard {
  scrydexCardId: string;
  name: string;
  game: CardGame;
  language?: string;
  releaseYear?: number;
  setExpansion?: string;
  cardNumber?: string;
  rarity?: string;
  officialImageUrl?: string;
  /**
   * Scrydex's raw confidence. Its scale is roughly 0.7–1.3+, NOT a percentage —
   * higher is better, and it is not bounded at 1. Stored verbatim and used for
   * ranking only. Do not render it as "N% match" without calibration guidance
   * from Scrydex; a 1.15 is not "115% confident".
   */
  matchScore: number;
}

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

interface ScrydexMatch {
  score?: number;
  variant?: string;
  card?: {
    id?: string;
    name?: string;
    number?: string;
    printed_number?: string;
    rarity?: string;
    language?: string;
    images?: { large?: string; small?: string }[];
    expansion?: { id?: string; name?: string; release_date?: string };
  };
}

interface ScrydexResponse {
  data?: {
    analysis?: {
      game?: string;
      language_code?: string;
      graded_details?: {
        company?: string;
        grade_label?: string;
        grade_number?: string;
        year?: string;
        cert?: string;
      };
    };
    matches?: ScrydexMatch[];
  };
}

const isConfigured = (): boolean =>
  Boolean(configs.SCRYDEX.api_key && configs.SCRYDEX.team_id);

const parseYear = (releaseDate?: string): number | undefined => {
  if (!releaseDate) return undefined;
  const year = Number(releaseDate.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
};

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
  if (!isConfigured()) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Card identification is not configured — SCRYDEX_API_KEY and SCRYDEX_TEAM_ID are required. See docs/OPEN-QUESTIONS.md.",
    );
  }

  const imageUrl = imageUrls[0];
  if (!imageUrl) {
    throw new AppError(httpStatus.BAD_REQUEST, "No image to identify.");
  }

  let response: Response;
  try {
    response = await fetch(
      `${configs.SCRYDEX.base_url}/vision/v1/cards/identify`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": configs.SCRYDEX.api_key as string,
          "X-Team-ID": configs.SCRYDEX.team_id as string,
        },
        body: JSON.stringify({
          image_url: imageUrl,
          games: [GAME_SLUG[game]],
        }),
      },
    );
  } catch (error) {
    // Network-level failure. Surfaced as 502 so the caller refunds the scan
    // rather than treating it as the user's fault.
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      `Could not reach the identification service: ${(error as Error).message}`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AppError(
      response.status === 401 || response.status === 403
        ? httpStatus.SERVICE_UNAVAILABLE
        : httpStatus.BAD_GATEWAY,
      `Identification service returned ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as ScrydexResponse;
  const matches = payload.data?.matches ?? [];

  const candidates: IdentifiedCard[] = matches
    // A match without an id cannot be upserted into the catalogue or confirmed
    // against later, so it is unusable rather than merely incomplete.
    .filter((m) => m.card?.id)
    .map((m) => ({
      scrydexCardId: m.card?.id as string,
      name: m.card?.name ?? "Unknown card",
      game,
      language: m.card?.language ?? payload.data?.analysis?.language_code,
      releaseYear: parseYear(m.card?.expansion?.release_date),
      setExpansion: m.card?.expansion?.name,
      cardNumber: m.card?.printed_number ?? m.card?.number,
      rarity: m.card?.rarity,
      officialImageUrl: m.card?.images?.[0]?.large ?? m.card?.images?.[0]?.small,
      matchScore: m.score ?? 0,
    }));

  // Scrydex documents matches as already sorted by confidence, but the
  // confirmation screen's "best match" depends on it, so sort defensively
  // rather than trusting response ordering.
  candidates.sort((a, b) => b.matchScore - a.matchScore);

  const graded = payload.data?.analysis?.graded_details;

  return {
    candidates,
    languageCode: payload.data?.analysis?.language_code,
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
};

export const IdentificationProvider = {
  identify,
  isConfigured,
};
