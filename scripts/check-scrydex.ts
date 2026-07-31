/**
 * Checks what the configured Scrydex credentials can actually do.
 *
 * Usage (from pixel-grade-ai-server/):
 *   npx tsx --env-file=.env scripts/check-scrydex.ts
 *
 * Exists because Scrydex entitlements are not discoverable any other way. There
 * is no endpoint that reports which features a team has, and a plan that lacks
 * one answers with a 401 — the same status as a wrong key. Two completely
 * different problems, one status code, and the only way to tell them apart is
 * to call each endpoint and read the body.
 *
 * That is not hypothetical: on 2026-07-31 the client's credentials read the
 * catalogue, prices, and history fine while Vision returned
 * `{"error":"You do not have access to this endpoint"}`. Run this before
 * concluding the integration is broken — and after Scrydex changes anything on
 * the account.
 *
 * ⚠️ Costs about 4 credits, one of which is a Vision call at 5 if it succeeds.
 * Failed Vision calls are billed too.
 */
import { CardGame } from "../src/app/modules/card/card.interface";
import { ScrydexCatalogue } from "../src/app/services/scrydex/scrydex.catalogue";
import { ScrydexClient, request } from "../src/app/services/scrydex/scrydex.client";
import { SCRYDEX_GAMES } from "../src/app/services/scrydex/scrydex.games";
import { selectQuote, toIdentifiedCards } from "../src/app/services/scrydex/scrydex.mapper";
import type { ScrydexVisionResponse } from "../src/app/services/scrydex/scrydex.types";

/**
 * Everything below goes through the Scrydex client directly rather than through
 * IdentificationProvider / PricingProvider — those consult the dev mock, and a
 * check that can be satisfied by fabricated data is not a check.
 */

/** A card that has existed since 1999 and will not be delisted. */
const PROBE_CARD = "base1-4";
const PROBE_IMAGE = "https://images.scrydex.com/pokemon/base1-4/large";

const ok = (label: string, detail: string) =>
  console.log(`  ✅ ${label.padEnd(16)} ${detail}`);
const bad = (label: string, detail: string) =>
  console.log(`  ❌ ${label.padEnd(16)} ${detail}`);

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const main = async () => {
  console.log("\nScrydex credential + entitlement check\n");

  if (!ScrydexClient.isConfigured()) {
    bad("credentials", "SCRYDEX_API_KEY and SCRYDEX_TEAM_ID must BOTH be set.");
    console.log(
      "\n  Note: Scrydex serves unauthenticated requests at a crippled rate\n" +
        "  limit rather than rejecting them, so a missing header shows up as\n" +
        "  mysterious throttling rather than an obvious auth error.\n",
    );
    process.exit(1);
  }

  let failures = 0;

  // 1. Usage — free, and the fastest proof the credentials are valid at all.
  try {
    const usage = await ScrydexClient.getUsage();
    const allowance = usage.creditsRemaining + usage.creditsConsumed;
    ok(
      "account",
      `${usage.creditsRemaining}/${allowance} credits left this period` +
        (usage.overageConsumed ? ` (⚠️ ${usage.overageConsumed} overage)` : ""),
    );
    // INFERRED, not reported. Scrydex has no endpoint that names the plan —
    // /account/v1/{plan,subscription,me,team,limits,billing} all 404, and
    // usage returns numbers only. This maps the allowance onto Scrydex's
    // published tiers, which a custom or legacy plan would defeat. The
    // allowance itself is the number to budget against.
    const tier =
      allowance >= 250_000
        ? "Professional"
        : allowance >= 50_000
          ? "Growth"
          : "Starter";
    ok(
      "tier",
      `~${allowance.toLocaleString()} credits/month — matches ${tier} ` +
        `(inferred; confirm on the Scrydex dashboard)`,
    );
  } catch (error) {
    failures += 1;
    bad("account", message(error));
  }

  // 2. Catalogue + pricing.
  try {
    const card = await ScrydexCatalogue.getCardWithPrices(
      CardGame.pokemon,
      PROBE_CARD,
    );
    const quote = selectQuote(card ?? undefined);
    if (quote) {
      ok(
        "pricing",
        `${PROBE_CARD} = ${quote.currency} ${quote.price} ` +
          `(${quote.basis}${quote.condition ? `, ${quote.condition}` : ""}, ` +
          `variant "${quote.variantName}")`,
      );
    } else {
      failures += 1;
      bad("pricing", `${PROBE_CARD} returned no quotable price.`);
    }
  } catch (error) {
    failures += 1;
    bad("pricing", message(error));
  }

  // 3. Historical archive — what seeds a new card's sparkline.
  try {
    const history = await ScrydexCatalogue.getPriceHistory(
      CardGame.pokemon,
      PROBE_CARD,
      30,
    );
    if (history.length > 0) {
      ok("price history", `${history.length} daily points for ${PROBE_CARD}`);
    } else {
      bad("price history", "reachable, but returned no points.");
    }
  } catch (error) {
    failures += 1;
    bad("price history", message(error));
  }

  // 4. Vision — the one that is separately entitled.
  try {
    const payload = await request<ScrydexVisionResponse>(
      "/vision/v1/cards/identify",
      {
        method: "POST",
        body: { image_url: PROBE_IMAGE, games: ["pokemon"] },
        vision: true,
        operation: "Vision entitlement check",
      },
    );
    const candidates = toIdentifiedCards(
      payload.data?.matches ?? [],
      CardGame.pokemon,
    );
    ok(
      "vision",
      `${candidates.length} candidates, best "${candidates[0]?.name}" ` +
        `(score ${candidates[0]?.matchScore}, variant "${candidates[0]?.scrydexVariant}")`,
    );
  } catch (error) {
    failures += 1;
    bad("vision", message(error));
    console.log(
      "\n     If that says 'You do not have access to this endpoint', the key is\n" +
        "     fine — Vision is not enabled for this team. Scrydex lists it on every\n" +
        "     tier, so ask their support to switch it on rather than upgrading.\n" +
        "     Until then set MOCK_SCRYDEX=vision in dev; pricing stays live.\n",
    );
  }

  const live = Object.entries(SCRYDEX_GAMES)
    .filter(([, config]) => config.live)
    .map(([game]) => game);
  console.log(`\n  Games enabled: ${live.join(", ") || "none"}\n`);

  process.exit(failures > 0 ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
