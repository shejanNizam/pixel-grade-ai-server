/**
 * Checks what the configured OpenAI credentials can actually do.
 *
 * Usage (from pixel-grade-ai-server/):
 *   npx tsx --env-file=.env scripts/check-openai.ts            # free, no billed calls
 *   npx tsx --env-file=.env scripts/check-openai.ts --live     # + 1 real grade, 1 real image
 *   npx tsx --env-file=.env scripts/check-openai.ts --live --repeat 3
 *
 * Exists because ONE credential backs both launch-blocking features. Grading and
 * slab background generation share `OPENAI_API_KEY` (IMAGEGEN_API_KEY is only an
 * override), so a dead key takes out both at once — and the two symptoms look
 * unrelated from the UI: "Grading Unsuccessful" on the scan flow and "Could not
 * generate any background artwork" on the Slab Generator. That is exactly what
 * happened on 2026-08-15: the key in .env was rejected with 401
 * `invalid_api_key`, and both features had been reported as separate bugs.
 *
 * The three failure modes this separates, which are indistinguishable from the
 * app's error messages:
 *
 *   1. BAD KEY        — 401 on everything. Nothing works.
 *   2. BAD MODEL ID   — auth fine, `OPENAI_GRADING_MODEL` 404s. Grading dies,
 *                       image generation is unaffected.
 *   3. UNVERIFIED ORG — auth fine, but gpt-image-1 403s until the organisation
 *                       completes OpenAI's verification. Grading works, the Slab
 *                       Generator dies. This one is easy to misread as a bug in
 *                       our code because three of the four EXT. ART options fail
 *                       identically and the batch reports only "try again".
 *
 * `--repeat N` covers the client's "test multiple consecutive grading requests"
 * bullet: a key that answers once but trips a rate limit on the second call is a
 * launch blocker that a single probe would pass.
 *
 * ⚠️ `--live` costs real money: one grading call plus one gpt-image-1 render
 * (~$0.02–$0.25). `--repeat` multiplies the grading half only. The default run
 * is free — it reads the model list and asks for metadata, nothing more.
 */
import OpenAI from "openai";
import { configs } from "../src/app/config/index";
import { GradingProvider } from "../src/app/services/grading";

/** A real card front, stable since 1999. Same probe as check-scrydex.ts. */
const PROBE_IMAGE = "https://images.scrydex.com/pokemon/base1-4/large";

const ok = (label: string, detail: string) =>
  console.log(`  ✅ ${label.padEnd(16)} ${detail}`);
const bad = (label: string, detail: string) =>
  console.log(`  ❌ ${label.padEnd(16)} ${detail}`);
const info = (label: string, detail: string) =>
  console.log(`  ·  ${label.padEnd(16)} ${detail}`);

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** OpenAI errors carry the useful part in `status`; AppError hides it. */
const status = (error: unknown): number | undefined =>
  error instanceof OpenAI.APIError ? error.status : undefined;

const args = process.argv.slice(2);
const live = args.includes("--live");
const repeat = Math.max(
  1,
  Number(args[args.indexOf("--repeat") + 1]) || (live ? 1 : 0),
);

/** Returns the exit code rather than calling process.exit — on Windows,
 *  exiting while an HTTPS socket is still closing trips a libuv assertion and
 *  the abort masks the report that was just printed. */
const main = async (): Promise<number> => {
  console.log("\nOpenAI credential + entitlement check\n");

  const gradingKey = configs.GRADING.openai_api_key;
  const imageKey = configs.IMAGEGEN.api_key || gradingKey;

  if (!gradingKey) {
    bad("credentials", "OPENAI_API_KEY is not set — grading cannot run.");
    return 1;
  }

  // Never print the key. The prefix and length are enough to tell a truncated
  // paste from a revoked key, which is the only thing worth knowing here.
  info(
    "grading key",
    `${gradingKey.slice(0, 11)}… (${gradingKey.length} chars)`,
  );
  info(
    "imagegen key",
    configs.IMAGEGEN.api_key
      ? `${configs.IMAGEGEN.api_key.slice(0, 11)}… (IMAGEGEN_API_KEY override)`
      : "same key as grading (no IMAGEGEN_API_KEY override)",
  );
  info("grading model", configs.GRADING.openai_model);
  info("model version", configs.GRADING.model_version);
  console.log();

  const client = new OpenAI({ apiKey: gradingKey });
  let failures = 0;

  // 1. Auth. Free, and the fastest proof the key is live at all.
  let modelIds: string[] = [];
  try {
    const list = await client.models.list();
    modelIds = list.data.map((m) => m.id);
    ok("auth", `key accepted — ${modelIds.length} models visible`);
  } catch (error) {
    failures += 1;
    bad(
      "auth",
      status(error) === 401
        ? `401 invalid_api_key — the key is revoked, deleted, or from ` +
            `another org. Mint a fresh one at platform.openai.com and ` +
            `replace OPENAI_API_KEY. Nothing below can pass until this does.`
        : message(error),
    );
    console.log(
      "\n  Both grading AND slab artwork run on this key. Fix it first —\n" +
        "  every failure below is a symptom of this one.\n",
    );
    return 1;
  }

  // 2. Is the configured grading model real and reachable by this account?
  //    A typo'd or deprecated model id 404s at call time and surfaces to the
  //    user as "temporarily unavailable", which reads as an outage forever.
  const model = configs.GRADING.openai_model;
  try {
    await client.models.retrieve(model);
    ok("grading model", `${model} exists and is visible to this account`);
  } catch (error) {
    failures += 1;
    bad(
      "grading model",
      `${model} — ${message(error)}\n` +
        `                     Set OPENAI_GRADING_MODEL to a vision-capable ` +
        `model this account can see, and bump GRADING_MODEL_VERSION with it.`,
    );
  }

  // 3. gpt-image-1 entitlement. Visible in the model list is NOT the same as
  //    callable — OpenAI gates it behind organisation verification, and the
  //    refusal only shows up on an actual generate call.
  if (modelIds.includes("gpt-image-1")) {
    ok("gpt-image-1", "listed for this account");
  } else {
    failures += 1;
    bad(
      "gpt-image-1",
      "not in this account's model list — the Slab Generator cannot run. " +
        "Usually means the organisation is not verified.",
    );
  }

  if (!live) {
    console.log(
      `\n  ${failures === 0 ? "Config looks sound." : `${failures} problem(s) above.`}` +
        `\n  Re-run with --live to prove it end to end (billed):\n` +
        `    npx tsx --env-file=.env scripts/check-openai.ts --live --repeat 3\n`,
    );
    return failures === 0 ? 0 : 1;
  }

  // 4. A real grade, through the real provider — prompt, structured-output
  //    schema, and model in one call. Repeated, because a key that answers once
  //    and then trips a rate limit still blocks launch.
  console.log(`\n  Live grading — ${repeat} consecutive call(s):\n`);
  const grades: number[] = [];
  for (let attempt = 1; attempt <= repeat; attempt += 1) {
    const started = Date.now();
    try {
      const result = await GradingProvider.grade({
        imageUrls: [PROBE_IMAGE],
        cardName: "Charizard",
        cardSet: "Base Set",
      });
      grades.push(result.grade);
      ok(
        `grade ${attempt}/${repeat}`,
        `${result.grade} (${result.gradeLabel}), confidence ${result.confidence}` +
          ` — ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      failures += 1;
      bad(`grade ${attempt}/${repeat}`, message(error));
    }
  }

  // Not a correctness check — the repeatability guarantee lives in the Redis
  // cache, not the model (see grading.types.ts). Spread across uncached calls is
  // just useful context on how much the cache is actually doing.
  if (grades.length > 1) {
    const spread = Math.max(...grades) - Math.min(...grades);
    info(
      "grade spread",
      `${spread.toFixed(1)} across ${grades.length} uncached calls ` +
        `(expected — determinism comes from the cache, not the model)`,
    );
  }

  // 5. One real image, cheap prompt. Proves the org can actually call
  //    gpt-image-1 rather than merely see it listed.
  console.log();
  try {
    const started = Date.now();
    const response = await new OpenAI({ apiKey: imageKey }).images.generate({
      model: "gpt-image-1",
      prompt: "A plain calm blue gradient background, no text, no objects.",
      size: "1024x1536",
      quality: "medium",
      n: 1,
    });
    if (response.data?.[0]?.b64_json) {
      ok(
        "image generate",
        `gpt-image-1 returned an image — ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } else {
      failures += 1;
      bad("image generate", "call succeeded but returned no image data");
    }
  } catch (error) {
    failures += 1;
    bad(
      "image generate",
      status(error) === 403
        ? `403 — the organisation must complete verification before it can ` +
            `call gpt-image-1. Slab artwork stays broken until it does.`
        : message(error),
    );
  }

  console.log(
    failures === 0
      ? "\n  All checks passed. Grading and slab artwork are both live.\n"
      : `\n  ${failures} check(s) failed — see above.\n`,
  );
  return failures === 0 ? 0 : 1;
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error("\nCheck aborted:", message(error), "\n");
    process.exitCode = 1;
  });
