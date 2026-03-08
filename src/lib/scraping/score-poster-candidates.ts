import type { ImageCandidate } from "./crawl-festival";

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

const W = {
  SOURCE_POSTER_PAGE: 40,
  SOURCE_LINEUP_PAGE: 20,
  KEYWORD_POSTER_FLYER_URL: 20,
  KEYWORD_LINEUP_ARTISTS_URL: 15,
  YEAR_CURRENT: 20,
  YEAR_NEXT: 10,
  YEAR_OLD: -15,
  KEYWORD_LINEUP_POSTER_ALT: 15,
  KEYWORD_LINEUP_POSTER_CONTEXT: 10,
  ASPECT_PORTRAIT: 15,    // h/w >= 1.2
  ASPECT_LANDSCAPE: -10,  // w/h >= 1.3
  DIMENSION_BOTH_LARGE: 10,
  DIMENSION_ONE_LARGE: 5,
} as const;

// ---------------------------------------------------------------------------
// Thresholds for "unambiguous" winner
// ---------------------------------------------------------------------------

export const UNAMBIGUOUS_MIN_SCORE = 30;
export const UNAMBIGUOUS_MIN_GAP = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  source: number;
  urlKeyword: number;
  year: number;
  altKeyword: number;
  contextKeyword: number;
  aspectRatio: number;
  dimensions: number;
}

export interface ScoredCandidate {
  candidate: ImageCandidate;
  score: number;
  breakdown: ScoreBreakdown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filenameOf(src: string): string {
  try {
    return new URL(src).pathname.toLowerCase();
  } catch {
    return src.toLowerCase();
  }
}

function containsYear(text: string, year: number): boolean {
  // Use word-boundary check to avoid matching year inside longer digit sequences
  // e.g. "12026" should not match year 2026
  return new RegExp(`(?<![0-9])${year}(?![0-9])`).test(text);
}

function hasKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function scorePosterCandidates(
  candidates: ImageCandidate[]
): ScoredCandidate[] {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  const scored: ScoredCandidate[] = candidates
    .filter((c) => c.sourceClassification !== "favicon") // favicons are never posters
    .map((candidate) => {
      const breakdown: ScoreBreakdown = {
        source: 0,
        urlKeyword: 0,
        year: 0,
        altKeyword: 0,
        contextKeyword: 0,
        aspectRatio: 0,
        dimensions: 0,
      };

      // --- Source page classification ---
      if (candidate.sourceClassification === "poster_only") {
        breakdown.source = W.SOURCE_POSTER_PAGE;
      } else if (candidate.sourceClassification === "lineup") {
        breakdown.source = W.SOURCE_LINEUP_PAGE;
      }

      // --- URL / filename keywords ---
      const urlPath = filenameOf(candidate.src);
      if (hasKeyword(urlPath, ["poster", "flyer"])) {
        breakdown.urlKeyword += W.KEYWORD_POSTER_FLYER_URL;
      }
      if (hasKeyword(urlPath, ["lineup", "artists", "performers", "acts"])) {
        breakdown.urlKeyword += W.KEYWORD_LINEUP_ARTISTS_URL;
      }

      // --- Year in URL, alt, or surrounding context (combined check) ---
      const allText = `${urlPath} ${candidate.alt} ${candidate.surroundingContext}`.toLowerCase();
      if (containsYear(allText, currentYear)) {
        breakdown.year = W.YEAR_CURRENT;
      } else if (containsYear(allText, nextYear)) {
        breakdown.year = W.YEAR_NEXT;
      } else {
        // Check for old years (anything before current)
        for (let y = currentYear - 1; y >= currentYear - 5; y--) {
          if (containsYear(allText, y)) {
            breakdown.year = W.YEAR_OLD;
            break;
          }
        }
      }

      // --- Alt text keywords ---
      const alt = candidate.alt.toLowerCase();
      if (hasKeyword(alt, ["lineup", "poster", "flyer", "artists", "acts"])) {
        breakdown.altKeyword = W.KEYWORD_LINEUP_POSTER_ALT;
      }

      // --- Surrounding context keywords ---
      const ctx = candidate.surroundingContext.toLowerCase();
      if (hasKeyword(ctx, ["lineup", "poster", "flyer", "artists", "acts"])) {
        breakdown.contextKeyword = W.KEYWORD_LINEUP_POSTER_CONTEXT;
      }

      // --- Aspect ratio ---
      const w = candidate.width;
      const h = candidate.height;
      if (w !== null && h !== null && w > 0 && h > 0) {
        const ratio = h / w;
        if (ratio >= 1.2) {
          breakdown.aspectRatio = W.ASPECT_PORTRAIT;
        } else if (w / h >= 1.3) {
          breakdown.aspectRatio = W.ASPECT_LANDSCAPE;
        }
      }

      // --- Dimensions ---
      const MIN_DIM = 800;
      if (
        w !== null && h !== null && !isNaN(w) && !isNaN(h) &&
        w >= MIN_DIM && h >= MIN_DIM
      ) {
        breakdown.dimensions = W.DIMENSION_BOTH_LARGE;
      } else if (
        (w !== null && !isNaN(w) && w >= MIN_DIM) ||
        (h !== null && !isNaN(h) && h >= MIN_DIM)
      ) {
        breakdown.dimensions = W.DIMENSION_ONE_LARGE;
      }

      const score =
        breakdown.source +
        breakdown.urlKeyword +
        breakdown.year +
        breakdown.altKeyword +
        breakdown.contextKeyword +
        breakdown.aspectRatio +
        breakdown.dimensions;

      return { candidate, score, breakdown };
    });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ---------------------------------------------------------------------------
// Helper: is the top result unambiguously the best?
// ---------------------------------------------------------------------------

export function isUnambiguousWinner(scored: ScoredCandidate[]): boolean {
  if (scored.length === 0) return false;
  if (scored.length === 1) return scored[0].score >= UNAMBIGUOUS_MIN_SCORE;
  return (
    scored[0].score >= UNAMBIGUOUS_MIN_SCORE &&
    scored[0].score - scored[1].score >= UNAMBIGUOUS_MIN_GAP
  );
}
