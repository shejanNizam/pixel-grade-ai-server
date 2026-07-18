import { configs } from "../../config/index";
import { ClaudeGradingProvider } from "./claude.provider";
import { isPixelVerified } from "./grading.types";
import { OpenAIGradingProvider } from "./openai.provider";

/**
 * Selects the grading vendor from `GRADING_PROVIDER` (openai | claude).
 *
 * Both implement the identical interface and constrain output to the same JSON
 * schema, so switching vendors changes only which API is billed — the parsed
 * result, the Redis cache, and the Pixel Verified rule are unaffected.
 *
 * ⚠️ Switching providers invalidates grading consistency for already-graded
 * cards: a different model will not reproduce the previous model's scores. The
 * cache key includes `GRADING_MODEL_VERSION` for exactly this reason — bump it
 * when you switch, so old reports keep their original grade and new scans
 * re-grade cleanly instead of silently mixing two models' output under one key.
 */
const selected =
  configs.GRADING.provider === "openai"
    ? OpenAIGradingProvider
    : ClaudeGradingProvider;

export const GradingProvider = {
  ...selected,
  isPixelVerified,
};

export type {
  GradingInput,
  GradingOutput,
  IGradingProvider,
} from "./grading.types";
