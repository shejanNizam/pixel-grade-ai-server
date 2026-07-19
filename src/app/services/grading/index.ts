import { isPixelVerified } from "./grading.types";
import { OpenAIGradingProvider } from "./openai.provider";

/**
 * The grading vendor: OpenAI.
 *
 * ⚠️ Changing the model invalidates grading consistency for already-graded
 * cards: a different model will not reproduce the previous model's scores. The
 * cache key includes `GRADING_MODEL_VERSION` for exactly this reason — bump it
 * when you change `OPENAI_GRADING_MODEL`, so old reports keep their original
 * grade and new scans re-grade cleanly instead of silently mixing two models'
 * output under one key.
 */
export const GradingProvider = {
  ...OpenAIGradingProvider,
  isPixelVerified,
};

export type {
  GradingInput,
  GradingOutput,
  IGradingProvider,
} from "./grading.types";
