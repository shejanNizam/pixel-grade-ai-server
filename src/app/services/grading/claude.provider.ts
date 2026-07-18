import Anthropic from "@anthropic-ai/sdk";
import httpStatus from "http-status";
import { configs } from "../../config/index";
import AppError from "../../errorHelpers/AppError";
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
 * Claude grading provider.
 *
 * See grading.types.ts for the consistency guarantee — it lives in the cache,
 * not here.
 */

let client: Anthropic | null = null;

const isConfigured = (): boolean => Boolean(configs.GRADING.anthropic_api_key);

const getClient = (): Anthropic => {
  if (!isConfigured()) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Claude grading is not configured — ANTHROPIC_API_KEY is missing.",
    );
  }
  client ??= new Anthropic({ apiKey: configs.GRADING.anthropic_api_key });
  return client;
};

const grade = async (input: GradingInput): Promise<GradingOutput> => {
  if (input.imageUrls.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "No images to grade");
  }

  const response = await getClient().messages.create({
    model: configs.GRADING.claude_model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    // Condition assessment benefits from deliberation, and adaptive lets the
    // model decide how much per image set rather than us guessing a budget.
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: gradingSchema },
    },
    messages: [
      {
        role: "user",
        content: [
          ...input.imageUrls.map(
            (url) => ({ type: "image", source: { type: "url", url } }) as const,
          ),
          { type: "text", text: buildUserPrompt(input) },
        ],
      },
    ],
  });

  // A safety refusal is a successful HTTP response, not an exception — checking
  // stop_reason before reading content avoids a confusing index error.
  if (response.stop_reason === "refusal") {
    throw new AppError(
      httpStatus.UNPROCESSABLE_ENTITY,
      "The grading model declined to assess these images.",
    );
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Grading model returned no readable result.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(textBlock.text) as Record<string, unknown>;
  } catch {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Grading model returned malformed JSON.",
    );
  }

  return normalise(parsed, configs.GRADING.model_version, response);
};

export const ClaudeGradingProvider: IGradingProvider = {
  name: "claude",
  grade,
  isConfigured,
};
