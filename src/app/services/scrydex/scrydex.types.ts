/**
 * Scrydex wire types — the vendor's shapes, not ours.
 *
 * Everything here mirrors what api.scrydex.com actually returns (verified
 * against the live account on 2026-07-31), so it is deliberately loose: almost
 * every field is optional because Scrydex omits rather than nulls large parts
 * of a card, and a card that is missing `printed_number` must not throw.
 *
 * Nothing outside `services/scrydex/` should import these. The mapper turns
 * them into our own types; the rest of the app never sees a snake_case field.
 */

export interface ScrydexImage {
  type?: string;
  small?: string;
  medium?: string;
  large?: string;
}

export interface ScrydexExpansion {
  id?: string;
  name?: string;
  series?: string;
  code?: string;
  total?: number;
  printed_total?: number;
  language?: string;
  language_code?: string;
  /** "YYYY/MM/DD" — slashes, not dashes. */
  release_date?: string;
  is_online_only?: boolean;
}

/**
 * One market quote.
 *
 * A single card carries many of these: one per (variant × condition × grade).
 * `base1-4` alone returns 19. Picking the right one is the whole job of
 * `selectQuote` in the mapper — see the rules documented there.
 */
export interface ScrydexPrice {
  /** "raw" | "graded". Everything this account returns today is "raw". */
  type?: string;
  /** Raw prices only: NM | LP | MP | HP | DM. */
  condition?: string;
  /** Graded prices only, e.g. "10". */
  grade?: string | null;
  /** Graded prices only, e.g. "PSA". */
  company?: string | null;
  /** A signed or misprinted copy trades as a different card — excluded. */
  is_perfect?: boolean;
  is_signed?: boolean;
  is_error?: boolean;
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  /** The authoritative figure. `low` is occasionally above it in the feed. */
  market?: number | null;
  currency?: string;
  source_currency?: string;
  /** Documented by Scrydex but absent on this account's plan — treat as never
   *  present and derive change percentages from our own PriceHistory instead. */
  trends?: Record<string, { price_change?: number; percent_change?: number }>;
}

export interface ScrydexMarketplace {
  name?: string;
  product_id?: string;
  purchase_url?: string;
}

/**
 * A printing of a card. This is the level prices hang off, and the reason the
 * catalogue stores `scrydexVariant`: Base Set Pikachu has ELEVEN variants whose
 * NM prices span two orders of magnitude, so a card id alone does not identify
 * a price.
 */
export interface ScrydexVariant {
  name?: string;
  origin?: string;
  images?: ScrydexImage[];
  marketplaces?: ScrydexMarketplace[];
  prices?: ScrydexPrice[];
  pop_reports?: {
    company?: string;
    total?: number;
    grade_total?: number;
    grades?: { grade?: string; count?: number }[];
  }[];
}

export interface ScrydexCard {
  id?: string;
  name?: string;
  supertype?: string;
  subtypes?: string[];
  types?: string[];
  number?: string;
  /** What is actually printed on the card, e.g. "4/102". Often null on modern
   *  and digital-only sets, where `number` is the only identifier. */
  printed_number?: string | null;
  rarity?: string;
  artist?: string;
  language?: string;
  language_code?: string;
  images?: ScrydexImage[];
  expansion?: ScrydexExpansion;
  variants?: ScrydexVariant[];
}

/** Every list endpoint is paginated with this envelope. */
export interface ScrydexList<T> {
  data?: T[];
  page?: number;
  page_size?: number;
  count?: number;
  total_count?: number;
}

export interface ScrydexSingle<T> {
  data?: T;
}

/* ------------------------------------------------------------------ Vision */

export interface ScrydexVisionMatch {
  /** Vendor scale, roughly 0.7–1.3 and unbounded. NOT a percentage. */
  score?: number;
  /** Which printing Vision thinks it saw. This is what makes later pricing
   *  accurate, so it is stored on the card rather than discarded. */
  variant?: string;
  card?: ScrydexCard;
}

export interface ScrydexVisionResponse {
  data?: {
    analysis?: {
      /** "raw" | "graded" — whether the photographed card is already slabbed. */
      type?: string;
      game?: string;
      language_code?: string;
      graded_details?: {
        company?: string;
        grade_code?: string;
        grade_label?: string;
        grade_number?: string;
        year?: string;
        cert?: string;
      };
    };
    matches?: ScrydexVisionMatch[];
  };
}

/* ------------------------------------------------------------------- Usage */

export interface ScrydexUsageResponse {
  data?: {
    total_credits_consumed?: number;
    overage_credits_consumed?: number;
    credits_remaining?: number;
    period_start?: string;
    period_end?: string;
    daily_usage?: { date?: string; credits_consumed?: number }[];
  };
}

/* ----------------------------------------------------------- Price history */

export interface ScrydexPriceHistoryPoint {
  /** "YYYY/MM/DD". */
  date?: string;
  prices?: (ScrydexPrice & { variant?: string })[];
}
