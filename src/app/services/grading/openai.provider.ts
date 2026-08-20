import httpStatus from "http-status";
import OpenAI from "openai";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
import { logger } from "../../utils/logger";
import {
  buildUserPrompt,
  gradingSchema,
  GradingInput,
  GradingOutput,
  IGradingProvider,
  normalise,
  SYSTEM_PROMPT,
} from "./grading.types";

/**
 * OpenAI grading provider.
 *
 * Uses chat.completions with structured outputs (`response_format.json_schema`,
 * `strict: true`), which guarantees the reply parses against `gradingSchema`
 * rather than merely being asked to.
 *
 * MODEL: set OPENAI_GRADING_MODEL explicitly. The default below is a known
 * vision-capable model, but OpenAI ships new ones frequently — confirm the
 * current best vision model against their model list rather than trusting this
 * default to still be optimal.
 *
 * See grading.types.ts for the consistency guarantee — it lives in the cache,
 * not here.
 */

let client: OpenAI | null = null;

const isConfigured = (): boolean => Boolean(configs.GRADING.openai_api_key);

const getClient = (): OpenAI => {
  if (!isConfigured()) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "OpenAI grading is not configured — OPENAI_API_KEY is missing.",
    );
  }
  client ??= new OpenAI({ apiKey: configs.GRADING.openai_api_key });
  return client;
};

const grade = async (input: GradingInput): Promise<GradingOutput> => {
  if (input.imageUrls.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "No images to grade");
  }

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await getClient().chat.completions.create({
      model: configs.GRADING.openai_model,
      max_completion_tokens: 4096,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "card_grade",
          strict: true,
          schema: gradingSchema as unknown as Record<string, unknown>,
        },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            ...input.imageUrls.map(
              (url) => ({ type: "image_url", image_url: { url } }) as const,
            ),
            { type: "text", text: buildUserPrompt(input) },
          ],
        },
      ],
    });
  } catch (err: unknown) {
    logger.error("OpenAI API call failed during grading:", err);
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "The AI grading service is temporarily unavailable. Please contact with support team or try again shortly.",
    );
  }

  const choice = response.choices[0];

  // A content filter stop is a 200 with empty content — reading it blindly
  // would surface as a confusing JSON parse error instead of the real cause.
  if (choice?.finish_reason === "content_filter") {
    throw new AppError(
      httpStatus.UNPROCESSABLE_ENTITY,
      "The grading model declined to assess these images.",
    );
  }
  // Truncation yields syntactically invalid JSON; naming it is far more useful
  // than "malformed JSON".
  if (choice?.finish_reason === "length") {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Grading response was truncated before completing — raise max_completion_tokens.",
    );
  }

  const text = choice?.message?.content;
  if (!text) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Grading model returned no readable result.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Grading model returned malformed JSON.",
    );
  }

  return normalise(parsed, configs.GRADING.model_version, response);
};

export const OpenAIGradingProvider: IGradingProvider = {
  name: "openai",
  grade,
  isConfigured,
};
