# Smart Poster Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the naive "take the first image from the highest-priority bucket" poster selection with a scored ranking system, Gemini-based disambiguation for ambiguous cases, and a retry loop that skips non-poster images during extraction.

**Architecture:** Five coordinated changes: (1) capture surrounding HTML context per image in the scraper, (2) a pure scoring module that ranks candidates algorithmically, (3) a Gemini Flash multi-image disambiguation call for ambiguous cases, (4) a new `is_lineup_poster` field in the Claude extraction tool so bad picks self-report, (5) a retry loop in the crawl orchestrator wiring it all together. If three consecutive extractions all return `is_lineup_poster: false`, the festival is flagged as lineup-pending for admin review.

**Tech Stack:** TypeScript, Cheerio (scraping context), Gemini Flash (disambiguation), Claude Sonnet (extraction), existing `crawl-festival.ts` orchestrator.

---

## Task 1: Add `surroundingContext` to the image scraper

**Files:**
- Modify: `src/lib/scraping/scrape-url.ts`

**Context:** The internal `ImageCandidate` type and `$("img").each()` loop need a `surroundingContext` field. This is extracted from the image's nearest heading, parent class/id, and figcaption — all available in the already-parsed Cheerio DOM, so no extra fetches needed.

**Step 1: Add `surroundingContext` to the `ImageCandidate` interface**

Find:
```typescript
export interface ImageCandidate {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
}
```

Replace with:
```typescript
export interface ImageCandidate {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
  /** Nearby heading, parent class/id, and figcaption text — used for poster scoring */
  surroundingContext: string;
}
```

**Step 2: Add a helper function before the `scrapeUrl` function**

Insert this function just above `export async function scrapeUrl`:

```typescript
function extractImageContext(
  $el: ReturnType<typeof cheerio.load> extends (html: string) => infer C ? ReturnType<C> : never,
  $: cheerio.CheerioAPI
): string {
  const parts: string[] = [];

  // Parent element class and id — often contains "poster", "lineup", "hero" etc.
  const parent = $($el).parent();
  const cls = parent.attr("class") ?? "";
  const id = parent.attr("id") ?? "";
  if (cls) parts.push(cls);
  if (id) parts.push(id);

  // figcaption — explicit caption text is a strong signal
  const figcaption = $($el).closest("figure").find("figcaption").first().text().trim();
  if (figcaption) parts.push(figcaption);

  // Nearest heading within the same section/article/div container
  const heading = $($el)
    .closest("section, article, div")
    .find("h1, h2, h3, h4")
    .first()
    .text()
    .trim();
  if (heading) parts.push(heading);

  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}
```

Note: the `$el` type above is complex — in practice Cheerio's `each` callback gives you a `cheerio.Element`. Use the simpler form below which matches how Cheerio callbacks work:

```typescript
function extractImageContext(el: cheerio.Element, $: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  const $el = $(el);

  const parent = $el.parent();
  const cls = parent.attr("class") ?? "";
  const id = parent.attr("id") ?? "";
  if (cls) parts.push(cls);
  if (id) parts.push(id);

  const figcaption = $el.closest("figure").find("figcaption").first().text().trim();
  if (figcaption) parts.push(figcaption);

  const heading = $el
    .closest("section, article, div")
    .find("h1, h2, h3, h4")
    .first()
    .text()
    .trim();
  if (heading) parts.push(heading);

  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}
```

**Step 3: Update the `$("img").each()` loop to capture context**

Find the line inside the `$("img").each()` loop that pushes to `images`:
```typescript
      seenSrc.add(resolved);
      images.push({
        src: resolved,
        alt: $(el).attr("alt") ?? "",
        width: w !== null && !isNaN(w) ? w : null,
        height: h !== null && !isNaN(h) ? h : null,
      });
```

Replace with:
```typescript
      seenSrc.add(resolved);
      images.push({
        src: resolved,
        alt: $(el).attr("alt") ?? "",
        width: w !== null && !isNaN(w) ? w : null,
        height: h !== null && !isNaN(h) ? h : null,
        surroundingContext: extractImageContext(el, $),
      });
```

**Step 4: Add `surroundingContext` to the og:image push**

The og:image is pushed manually before the `$("img").each()` loop. It has no real context. Find:
```typescript
        images.push({ src: resolved, alt: "og:image", width: null, height: null });
```

Replace with:
```typescript
        images.push({ src: resolved, alt: "og:image", width: null, height: null, surroundingContext: "" });
```

**Step 5: TypeScript check**

```bash
cd "C:\Users\eorge\Documents\workspace\festivalFinder" && npx tsc --noEmit 2>&1
```

Expected: errors in `crawl-festival.ts` about `surroundingContext` missing from places that construct `ImageCandidate` — fixed in Task 2.

**Step 6: Commit**

```bash
git add src/lib/scraping/scrape-url.ts
git commit -m "feat: capture surrounding HTML context for each image during scraping"
```

---

## Task 2: Propagate `surroundingContext` through `crawl-festival.ts`

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

**Context:** `crawl-festival.ts` defines its own exported `ImageCandidate` interface and constructs those objects from the scraper's internal `ImageCandidate`. Both need `surroundingContext`.

**Step 1: Add `surroundingContext` to the exported `ImageCandidate` interface**

Find:
```typescript
export interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
}
```

Replace with:
```typescript
export interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
  /** Nearby heading, parent class/id, figcaption — captured during scraping */
  surroundingContext: string;
}
```

**Step 2: Add `surroundingContext` to every `imageCandidates` mapping block**

There is one block that builds `imageCandidates` from the four buckets (posterPageImages, lineupImages, fallbackImages, ogImage). Find each `.map((c) => ({` call and add `surroundingContext: c.img.surroundingContext` (for bucket items) or `surroundingContext: ""` (for ogImage and favicon).

The posterPageImages map:
```typescript
  ...posterPageImages.map((c) => ({
    src: c.img.src,
    alt: c.img.alt,
    sourcePage: c.sourcePage,
    sourceClassification: "poster_only" as const,
    width: c.img.width,
    height: c.img.height,
    surroundingContext: c.img.surroundingContext,   // ADD
  })),
```

Repeat the same `surroundingContext: c.img.surroundingContext` addition for `lineupImages` and `fallbackImages` maps.

For the ogImage object:
```typescript
      ...(ogImage
        ? [{
            src: ogImage.img.src,
            alt: ogImage.img.alt,
            sourcePage: ogImage.sourcePage,
            sourceClassification: "og" as const,
            width: ogImage.img.width,
            height: ogImage.img.height,
            surroundingContext: "",   // ADD — og:image has no DOM context
          }]
        : []),
```

For the favicon push:
```typescript
  imageCandidates.push({
    src: homepage.faviconUrl,
    alt: "favicon",
    sourcePage: homepage.url,
    sourceClassification: "favicon",
    width: null,
    height: null,
    surroundingContext: "",   // ADD
  });
```

**Step 3: TypeScript check — should be clean**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: propagate surroundingContext through crawl image candidates"
```

---

## Task 3: Create the poster scoring module

**Files:**
- Create: `src/lib/scraping/score-poster-candidates.ts`

**Context:** Pure scoring logic. No I/O, no AI calls. Takes the `ImageCandidate[]` from `crawl-festival.ts` and returns them sorted by score, highest first, with a breakdown for logging. The current year is derived at runtime.

**Step 1: Create the file**

```typescript
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
  return text.includes(String(year));
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
      if (hasKeyword(urlPath, ["lineup", "artists", "artist", "performers", "acts"])) {
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
```

**Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors (this file only imports a type from `crawl-festival.ts` — no circular dependency since `crawl-festival.ts` doesn't import this yet).

**Step 3: Commit**

```bash
git add src/lib/scraping/score-poster-candidates.ts
git commit -m "feat: add algorithmic poster image scoring module"
```

---

## Task 4: Create Gemini Flash poster disambiguation

**Files:**
- Create: `src/lib/ai/providers/gemini/select-poster.ts`

**Context:** When scores are ambiguous, we send the top N candidate images (as base64) to Gemini Flash in a single call and ask which is the lineup poster. Returns the index of the best candidate, or 0 if uncertain.

**Step 1: Create the file**

```typescript
import { GoogleGenerativeAI, SchemaType, FunctionCallingMode } from "@google/generative-ai";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const MODEL = "gemini-2.5-flash";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface ImageForDisambiguation {
  base64: string;
  contentType: string;
  src: string; // for logging only
}

export interface SelectPosterResult {
  selectedIndex: number;
  usage: AiUsage;
}

export async function selectPosterWithGemini(
  images: ImageForDisambiguation[]
): Promise<SelectPosterResult> {
  if (images.length === 0) {
    return { selectedIndex: 0, usage: { inputTokens: 0, outputTokens: 0, model: MODEL } };
  }

  if (images.length === 1) {
    return { selectedIndex: 0, usage: { inputTokens: 0, outputTokens: 0, model: MODEL } };
  }

  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [
      {
        functionDeclarations: [
          {
            name: "select_lineup_poster",
            description: "Select the index of the image most likely to be a festival lineup poster.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                selected_index: {
                  type: SchemaType.NUMBER,
                  description: "Zero-based index of the image that is a festival lineup poster, or -1 if none appear to be a lineup poster.",
                },
                reason: {
                  type: SchemaType.STRING,
                  description: "Brief explanation of why this image was selected.",
                },
              },
              required: ["selected_index", "reason"],
            },
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: ["select_lineup_poster"],
      },
    },
  });

  // Build content parts: text prompt + one image per candidate
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `You are given ${images.length} images from a music festival website. Identify which image (if any) is a festival lineup poster — an image that shows the names of artists or bands performing at the festival, typically in a stylised graphic format with the festival name and dates.

A lineup poster usually:
- Lists multiple artist/band names in varying font sizes (headliners largest)
- Shows the festival name and often the dates
- Has a designed/branded appearance

It is NOT a hero banner, sponsor logo, general marketing image, or site decoration.

Examine each image and call select_lineup_poster with the index (0-based) of the lineup poster, or -1 if none qualify.`,
    },
  ];

  for (let i = 0; i < images.length; i++) {
    parts.push({ text: `Image ${i}:` });
    parts.push({
      inlineData: {
        mimeType: images[i].contentType,
        data: images[i].base64,
      },
    });
  }

  const result = await model.generateContent({ contents: [{ role: "user", parts }] });

  const call = result.response.functionCalls()?.[0];
  let selectedIndex = 0;
  if (call) {
    const args = call.args as { selected_index: number; reason: string };
    console.log(`[poster-select] Gemini selected index ${args.selected_index}: ${args.reason}`);
    selectedIndex = args.selected_index >= 0 && args.selected_index < images.length
      ? args.selected_index
      : 0;
  }

  return {
    selectedIndex,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
```

**Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/ai/providers/gemini/select-poster.ts
git commit -m "feat: add Gemini Flash multi-image poster disambiguation"
```

---

## Task 5: Add `is_lineup_poster` to Claude extraction tool

**Files:**
- Modify: `src/lib/extraction.ts`

**Context:** The Claude Sonnet extraction tool currently returns festival name, dates, location, artists, etc. We add `is_lineup_poster: boolean` to the schema so the model can self-report when the image isn't a lineup poster at all — letting the caller skip to the next candidate rather than accepting empty/wrong results.

**Step 1: Add `is_lineup_poster` to the `ExtractionResult` interface**

Find:
```typescript
export interface ExtractionResult {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  description?: string;
  ticket_url?: string;
  social_links?: SocialLinks;
  has_camping?: boolean;
  camping_details?: string;
  age_restriction?: string;
  artists: ExtractedArtist[];
  lineup_pending?: boolean;
  lineup_may_be_incomplete?: boolean;
}
```

Replace with:
```typescript
export interface ExtractionResult {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  description?: string;
  ticket_url?: string;
  social_links?: SocialLinks;
  has_camping?: boolean;
  camping_details?: string;
  age_restriction?: string;
  artists: ExtractedArtist[];
  lineup_pending?: boolean;
  lineup_may_be_incomplete?: boolean;
  /** false if the image is not a lineup poster (banner, logo, sponsor graphic, etc.) */
  is_lineup_poster?: boolean;
}
```

**Step 2: Add `is_lineup_poster` to the tool input_schema**

Find the `properties` object inside `extractionTool`. After the `artists` property (and before the closing `}`), add:

```typescript
      is_lineup_poster: {
        type: "boolean",
        description: "Set to false if this image is NOT a festival lineup poster (e.g. it is a hero banner, background image, logo, sponsor graphic, or general marketing photo). Set to true if it shows artist/band names for the festival lineup.",
      },
```

Also add `"is_lineup_poster"` to the `required` array:

```typescript
    required: ["festival_name", "dates", "location", "region", "website_url", "artists", "is_lineup_poster"],
```

**Step 3: Update the user prompt text in `extractFromPoster`**

Find the `text` field of the user message (the string starting with `"Analyze this music festival poster..."`). Add this paragraph at the start, before the existing rules:

```
IMPORTANT: First determine whether this image is a festival lineup poster — an image that lists artist or band names performing at the festival. If it is NOT (e.g. it is a hero banner, background graphic, logo, sponsor image, or general marketing photo), set is_lineup_poster to false and return an empty artists array. Do not attempt to extract artists from non-poster images.

If it IS a lineup poster, set is_lineup_poster to true and apply the following rules:
```

**Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/lib/extraction.ts
git commit -m "feat: add is_lineup_poster field to Claude extraction tool schema"
```

---

## Task 6: Wire scoring, disambiguation, and retry loop into `crawl-festival.ts`

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

**Context:** This is the main orchestration change. After the BFS loop and after `imageCandidates` is built, we: (1) score and rank all candidates, (2) log scores to console, (3) check for unambiguous winner or dispatch Gemini disambiguation, (4) attempt extraction in scored order with a 3-attempt limit, bailing out with `lineup_pending` if all three fail. All significant steps emit UI progress events.

**Constants to add near the top of the file (in the Constants section):**

```typescript
const MAX_POSTER_ATTEMPTS = 3;
const GEMINI_DISAMBIGUATION_TOP_N = 5;
```

**Step 1: Add imports at the top of the file**

After the existing imports, add:

```typescript
import { scorePosterCandidates, isUnambiguousWinner } from "./score-poster-candidates";
import { selectPosterWithGemini } from "@/lib/ai/providers/gemini/select-poster";
import type { ImageForDisambiguation } from "@/lib/ai/providers/gemini/select-poster";
```

**Step 2: Add disambiguation token tracking to `CrawlUsageTracker`**

Open `src/lib/scraping/scrape-usage.ts`. Check if it has a method for tracking arbitrary AI usage — if `addFilterLinks`, `addClassifyPage`, and `addExtraction` all exist, add a new method:

```typescript
addSelectPoster(usage: AiUsage): void {
  this.selectPoster = (this.selectPoster ?? 0) + usage.inputTokens;
  // follow the same pattern as the existing methods
}
```

If `CrawlUsageTracker` uses a different internal pattern (e.g. a flat object), follow that pattern exactly. The key is that Gemini disambiguation usage is tracked separately in the usage summary.

**Step 3: Replace the poster extraction block with the new scored+retry logic**

The current poster extraction block lives inside the `if (lineupContent.length > 0 || infoContent.length > 0)` branch. It looks like:

```typescript
    } else if (!extraction.lineup_pending && bestCandidateForExtraction) {
      // ... extractFromPoster(bestCandidateForExtraction.img.src) ...
    }
```

Replace **only that `else if` sub-branch** (not the whole outer if-block) with the following. Keep the `if (hasRichLineupPage)` and `if (!extraction.lineup_pending && ...)` structure — just replace the inner extraction call:

```typescript
    } else if (!extraction.lineup_pending) {
      // -----------------------------------------------------------------------
      // Score and rank image candidates
      // -----------------------------------------------------------------------

      const scored = scorePosterCandidates(imageCandidates);

      console.log(`[poster-score] Scored ${scored.length} candidate(s):`);
      for (const sc of scored.slice(0, 8)) {
        console.log(
          `  [${sc.score.toString().padStart(3)}] ${sc.candidate.src}` +
          `\n         breakdown: source=${sc.breakdown.source} url=${sc.breakdown.urlKeyword}` +
          ` year=${sc.breakdown.year} alt=${sc.breakdown.altKeyword}` +
          ` ctx=${sc.breakdown.contextKeyword} ratio=${sc.breakdown.aspectRatio}` +
          ` dims=${sc.breakdown.dimensions}`
        );
      }

      if (scored.length === 0) {
        emit({
          stage: "extracting",
          message: "No poster candidates found — skipping poster scan",
          usage: tracker.getSummary(),
        });
      } else {
        // -----------------------------------------------------------------------
        // Disambiguation: if ambiguous, ask Gemini to pick
        // -----------------------------------------------------------------------

        let rankedCandidates = scored;
        const unambiguous = isUnambiguousWinner(scored);

        if (unambiguous) {
          emit({
            stage: "poster_search",
            message: `Clear poster candidate (score: ${scored[0].score}) — ${new URL(scored[0].candidate.src).pathname}`,
            usage: tracker.getSummary(),
          });
          console.log(`[poster-score] Unambiguous winner (score ${scored[0].score}, gap ${scored[0].score - (scored[1]?.score ?? 0)})`);
        } else {
          const topN = scored.slice(0, GEMINI_DISAMBIGUATION_TOP_N);
          emit({
            stage: "poster_search",
            message: `Scores ambiguous — asking Gemini to pick best poster from top ${topN.length} candidate(s)`,
            usage: tracker.getSummary(),
          });
          console.log(`[poster-select] Ambiguous — fetching top ${topN.length} images for Gemini disambiguation`);

          try {
            const imagesForGemini: ImageForDisambiguation[] = [];
            for (const sc of topN) {
              try {
                const controller = new AbortController();
                const t = setTimeout(() => controller.abort(), 10_000);
                const res = await fetch(sc.candidate.src, { signal: controller.signal });
                clearTimeout(t);
                if (!res.ok) continue;
                const ct = res.headers.get("content-type") || "image/jpeg";
                if (!ct.startsWith("image/")) continue;
                const buf = Buffer.from(await res.arrayBuffer());
                imagesForGemini.push({
                  base64: buf.toString("base64"),
                  contentType: ct,
                  src: sc.candidate.src,
                });
              } catch (fetchErr) {
                console.warn(`[poster-select] Failed to fetch candidate for disambiguation: ${sc.candidate.src}`, fetchErr);
              }
            }

            if (imagesForGemini.length > 0) {
              const selectResult = await selectPosterWithGemini(imagesForGemini);
              tracker.addSelectPoster(selectResult.usage);

              // Reorder: put Gemini's pick first, keep rest in score order
              const winningSrc = imagesForGemini[selectResult.selectedIndex].src;
              const winner = scored.find((s) => s.candidate.src === winningSrc);
              const rest = scored.filter((s) => s.candidate.src !== winningSrc);
              if (winner) {
                rankedCandidates = [winner, ...rest];
                emit({
                  stage: "poster_search",
                  message: `Gemini selected: ${new URL(winningSrc).pathname}`,
                  usage: tracker.getSummary(),
                });
                console.log(`[poster-select] Gemini winner: ${winningSrc}`);
              }
            } else {
              emit({
                stage: "poster_search",
                message: "Could not fetch candidates for disambiguation — using score order",
                usage: tracker.getSummary(),
              });
            }
          } catch (disambigErr) {
            console.warn("[poster-select] Gemini disambiguation failed — falling back to score order:", disambigErr);
            emit({
              stage: "poster_search",
              message: "Poster disambiguation failed — using score order",
              usage: tracker.getSummary(),
            });
          }
        }

        // -----------------------------------------------------------------------
        // Retry loop: try extraction on ranked candidates, up to MAX_POSTER_ATTEMPTS
        // -----------------------------------------------------------------------

        let posterExtractionSucceeded = false;
        let attemptCount = 0;

        for (const sc of rankedCandidates) {
          if (attemptCount >= MAX_POSTER_ATTEMPTS) break;
          if (signal?.aborted) break;

          attemptCount++;
          const candidatePath = (() => { try { return new URL(sc.candidate.src).pathname; } catch { return sc.candidate.src; } })();

          emit({
            stage: "extracting",
            message: `Scanning poster (attempt ${attemptCount}/${MAX_POSTER_ATTEMPTS}): ${candidatePath}`,
            usage: tracker.getSummary(),
          });
          console.log(`[poster-extract] Attempt ${attemptCount}/${MAX_POSTER_ATTEMPTS}: ${sc.candidate.src} (score: ${sc.score})`);

          try {
            const posterResult = await extractFromPoster(sc.candidate.src);
            tracker.addExtraction(posterResult.usage);

            if (posterResult.extraction.is_lineup_poster === false) {
              console.log(`[poster-extract] Not a lineup poster — skipping to next candidate`);
              emit({
                stage: "extracting",
                message: `Image was not a lineup poster — trying next candidate`,
                usage: tracker.getSummary(),
              });
              continue;
            }

            // Success — merge artists
            posterExtractionSucceeded = true;
            const existingNames = new Set(extraction.artists.map((a) => a.name.toLowerCase()));
            const newArtists = posterResult.extraction.artists.filter(
              (a) => !existingNames.has(a.name.toLowerCase())
            );

            if (newArtists.length > 0) {
              extraction = { ...extraction, artists: [...extraction.artists, ...newArtists] };
              source = "text+poster";
              emit({
                stage: "extracting",
                message: `Poster added ${newArtists.length} additional artist(s) — total: ${extraction.artists.length}`,
                usage: tracker.getSummary(),
              });
            } else {
              emit({
                stage: "extracting",
                message: "Poster scan complete — no additional artists found",
                usage: tracker.getSummary(),
              });
            }
            break;
          } catch (extractErr) {
            console.warn(`[poster-extract] Extraction failed for ${sc.candidate.src}:`, extractErr);
            emit({
              stage: "extracting",
              message: `Poster extraction failed — trying next candidate`,
              usage: tracker.getSummary(),
            });
          }
        }

        // -----------------------------------------------------------------------
        // All attempts exhausted without a lineup poster — flag for admin review
        // -----------------------------------------------------------------------

        if (!posterExtractionSucceeded && attemptCount >= MAX_POSTER_ATTEMPTS) {
          console.log(`[poster-extract] ${MAX_POSTER_ATTEMPTS} attempts all returned non-poster images — assuming lineup not yet available`);
          extraction = { ...extraction, lineup_pending: true };
          lineupPending = true;
          if (!deepScrapeCandidate) {
            deepScrapeCandidate = {
              url: discoveredLineupUrl ?? startUrl,
              reason: `No lineup poster found after ${MAX_POSTER_ATTEMPTS} extraction attempt(s) — lineup may not yet be announced. Admin review recommended.`,
            };
          }
          emit({
            stage: "extracting",
            message: `No lineup poster found after ${MAX_POSTER_ATTEMPTS} attempt(s) — flagged for admin review`,
            usage: tracker.getSummary(),
          });
        }
      }
    }
```

Also update the `else if (bestCandidateForExtraction)` fallback branch (used when there is no text content at all, only images). This branch should also use the scorer:

Find:
```typescript
  } else if (bestCandidateForExtraction) {
    emit({
      stage: "poster_fallback",
      message: "No HTML content found. Extracting from poster image...",
      usage: tracker.getSummary(),
    });

    const posterResult = await extractFromPoster(bestCandidateForExtraction.img.src);
    tracker.addExtraction(posterResult.usage);
    extraction = posterResult.extraction;
    source = "poster";
```

Replace with (note: `imageCandidates` is built earlier, before this block):
```typescript
  } else if (imageCandidates.filter(c => c.sourceClassification !== "favicon").length > 0) {
    const scored = scorePosterCandidates(imageCandidates);
    console.log(`[poster-score] Fallback path — ${scored.length} candidate(s) scored`);
    for (const sc of scored.slice(0, 5)) {
      console.log(`  [${sc.score}] ${sc.candidate.src}`);
    }

    emit({
      stage: "poster_fallback",
      message: "No HTML content found. Extracting from best scored poster image...",
      usage: tracker.getSummary(),
    });

    let fallbackSucceeded = false;
    for (const sc of scored.slice(0, MAX_POSTER_ATTEMPTS)) {
      try {
        const posterResult = await extractFromPoster(sc.candidate.src);
        tracker.addExtraction(posterResult.usage);
        if (posterResult.extraction.is_lineup_poster === false) {
          console.log(`[poster-extract] Fallback: not a lineup poster — trying next`);
          continue;
        }
        extraction = posterResult.extraction;
        source = "poster";
        fallbackSucceeded = true;
        break;
      } catch (err) {
        console.warn(`[poster-extract] Fallback extraction failed:`, err);
      }
    }
    if (!fallbackSucceeded) {
      throw new Error("Could not find any lineup poster or text content");
    }
```

**Step 4: Remove the now-unused `bestCandidateForExtraction` variable**

Find and delete:
```typescript
  const bestCandidateForExtraction =
    posterPageImages[0] ?? lineupImages[0] ?? fallbackImages[0] ?? ogImage;
```

**Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors. Fix any type errors before committing.

**Step 6: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: wire poster scoring, Gemini disambiguation, and retry loop into crawl"
```

---

## Task 7: Add `addSelectPoster` to `CrawlUsageTracker`

**Files:**
- Modify: `src/lib/scraping/scrape-usage.ts`

**Context:** The Gemini disambiguation call produces usage data that should be tracked in the usage summary visible to the UI and stored in `ScrapeLog`.

**Step 1: Read `scrape-usage.ts` to understand the current pattern**

Read the file to see how existing `add*` methods are implemented (e.g. `addFilterLinks`, `addClassifyPage`). Follow the exact same pattern.

**Step 2: Add `addSelectPoster` method**

Add a new method following the existing pattern. It should track Gemini Flash disambiguation tokens under a new category (e.g. `selectPoster`) in both the running total and the per-call breakdown.

**Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/lib/scraping/scrape-usage.ts
git commit -m "feat: track Gemini poster disambiguation usage in CrawlUsageTracker"
```

---

## Task 8: Manual verification

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Test with a festival that has an obvious lineup poster**

Navigate to `/admin/festivals/new` and scrape a festival URL known to have a clear poster (e.g. a festival whose lineup page has an image named `lineup-2026.jpg`).

**Verify in terminal logs:**
- `[poster-score]` lines appear listing candidates with scores
- The correct image wins with a high score and large gap
- `[poster-extract] Attempt 1/3` line appears for the winner
- If successful, `Poster added N artist(s)` appears in UI log

**Step 3: Test with a festival whose homepage has a hero banner as the only image**

**Verify:**
- `[poster-extract]` attempts are logged for each candidate
- If none are lineup posters, UI shows "No lineup poster found after 3 attempts — flagged for admin review"
- Festival creation still succeeds with `lineupPending: true`

**Step 4: Test ambiguous case (if possible)**

Manually edit `score-poster-candidates.ts` temporarily to set `UNAMBIGUOUS_MIN_GAP = 999` to force the disambiguation path. Verify:
- `[poster-select]` log lines appear
- Gemini picks one image
- UI emits "Gemini selected: ..." message
- Revert the change after testing

**Step 5: Check no regressions**

Run an existing festival through the edit-scrape path. Verify no errors. Check TypeScript:

```bash
npx tsc --noEmit 2>&1
```

---

## Summary of files changed

| File | Change |
|---|---|
| `src/lib/scraping/scrape-url.ts` | Add `surroundingContext` to `ImageCandidate`, capture in `$("img").each()` |
| `src/lib/scraping/crawl-festival.ts` | Propagate `surroundingContext`, wire scoring+disambiguation+retry loop |
| `src/lib/scraping/score-poster-candidates.ts` | **New** — algorithmic scorer, weights, `isUnambiguousWinner` |
| `src/lib/ai/providers/gemini/select-poster.ts` | **New** — Gemini Flash multi-image disambiguation |
| `src/lib/extraction.ts` | Add `is_lineup_poster` to tool schema and prompt |
| `src/lib/scraping/scrape-usage.ts` | Add `addSelectPoster` usage tracking method |
