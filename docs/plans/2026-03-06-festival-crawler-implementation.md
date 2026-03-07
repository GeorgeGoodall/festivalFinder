# Festival Website Crawler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace poster upload + lineup URL scraping with a unified BFS web crawler that explores festival websites to extract all festival data automatically.

**Architecture:** BFS crawler fetches the homepage, uses Haiku to filter links and classify pages (lineup/info/poster/irrelevant), collects content into three buckets, then runs a final Haiku extraction. Falls back to Sonnet vision if only a poster image is found. SSE streams progress to the admin UI.

**Tech Stack:** Next.js 16 (App Router), cheerio (HTML parsing), Anthropic SDK (Haiku + Sonnet), Prisma 7, Supabase Storage, SSE (ReadableStream)

---

### Task 1: Add posterPageUrl field to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:57-59`

**Step 1: Add the field**

In `prisma/schema.prisma`, add `posterPageUrl` after `lineupUrl`:

```prisma
  lineupUrl      String?        @map("lineup_url")
  lineupHash     String?        @map("lineup_hash")
  posterPageUrl  String?        @map("poster_page_url")
  lastScrapedAt  DateTime?      @map("last_scraped_at")
```

**Step 2: Run migration**

Run: `npx prisma db push`
Expected: Schema synced, no errors.

**Step 3: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: Client regenerated with `posterPageUrl` field.

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add posterPageUrl field to Festival model"
```

---

### Task 2: Create scrape-url.ts — page fetching, link extraction, image extraction

This is the foundation layer. It fetches a URL, extracts clean text (using cheerio like the existing `scraping.ts`), extracts all links with surrounding context, and extracts candidate poster image URLs.

**Files:**
- Create: `src/lib/scraping/scrape-url.ts`
- Reference: `src/lib/scraping.ts` (existing — reuse `cleanHtml` and `hashContent` patterns)

**Step 1: Create the file**

```typescript
import * as cheerio from "cheerio";
import { createHash } from "crypto";

const FETCH_TIMEOUT_MS = 15_000;

const SKIP_EXTENSIONS = new Set([
  ".css", ".js", ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".avi", ".mov", ".wmv",
  ".zip", ".tar", ".gz", ".rar",
]);

export interface LinkWithContext {
  url: string;
  text: string;
  context: string;
}

export interface ImageCandidate {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface ScrapeResult {
  url: string;
  text: string;
  jsonLd: string | null;
  links: LinkWithContext[];
  images: ImageCandidate[];
  title: string;
}

/**
 * Normalize a URL for deduplication:
 * - Strip fragment
 * - Add trailing slash if no file extension
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    if (!u.pathname.endsWith("/") && !u.pathname.includes(".", u.pathname.lastIndexOf("/"))) {
      u.pathname += "/";
    }
    return u.href;
  } catch {
    return raw;
  }
}

/**
 * SHA-256 hash of text content for change detection.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function isSkippableUrl(href: string): boolean {
  try {
    const pathname = new URL(href).pathname.toLowerCase();
    if (pathname.includes("/cdn-cgi/")) return true;
    const ext = pathname.substring(pathname.lastIndexOf("."));
    return SKIP_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function isImageExtension(pathname: string): boolean {
  const ext = pathname.toLowerCase().substring(pathname.lastIndexOf("."));
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
}

/**
 * Fetch a URL and extract text content, links, and images.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FestivalFinder/1.0; +https://festivalfinder.uk)",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Extract title
  const title = $("title").first().text().trim() || url;

  // Extract JSON-LD before stripping scripts
  let jsonLd: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (content) {
      jsonLd = (jsonLd ? jsonLd + "\n" : "") + content;
    }
  });

  // Extract links with context before cleaning
  const links: LinkWithContext[] = [];
  const seenUrls = new Set<string>();
  const baseDomain = new URL(url).hostname;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
      return;
    }

    const resolved = resolveUrl(url, href);
    if (!resolved) return;

    try {
      if (new URL(resolved).hostname !== baseDomain) return;
    } catch {
      return;
    }

    if (isSkippableUrl(resolved)) return;

    const normalized = normalizeUrl(resolved);
    if (normalized === normalizeUrl(url)) return; // Skip self-links
    if (seenUrls.has(normalized)) return;
    seenUrls.add(normalized);

    const linkText = $(el).text().trim();
    const parent = $(el).closest("p, li, div, section, article, td");
    const context = (parent.text() || "").trim().slice(0, 200);

    links.push({ url: normalized, text: linkText, context });
  });

  // Extract candidate poster images
  const images: ImageCandidate[] = [];

  // Check og:image first
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    const resolved = resolveUrl(url, ogImage);
    if (resolved) {
      images.push({ src: resolved, alt: "og:image", width: null, height: null });
    }
  }

  // Extract large images from the page
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;

    const resolved = resolveUrl(url, src);
    if (!resolved) return;

    const width = parseInt($(el).attr("width") || "0", 10) || null;
    const height = parseInt($(el).attr("height") || "0", 10) || null;
    const alt = $(el).attr("alt") || "";

    // Include if dimensions are large enough, or if no dimensions but has image extension
    const isLargeEnough = (width && width >= 400) || (height && height >= 400);
    const hasImageExt = isImageExtension(new URL(resolved).pathname);

    if (isLargeEnough || (!width && !height && hasImageExt)) {
      images.push({ src: resolved, alt, width, height });
    }
  });

  // Clean HTML for text extraction
  $("script, style, nav, footer, header, iframe, noscript, svg, form").remove();
  $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { url, text, jsonLd, links, images, title };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in `scrape-url.ts`.

**Step 3: Commit**

```bash
git add src/lib/scraping/scrape-url.ts
git commit -m "feat: add scrape-url with link and image extraction"
```

---

### Task 3: Create scrape-usage.ts — usage tracking

Tracks AI token usage and costs across the crawl. Adapted from projectBidWriter but uses Anthropic Haiku pricing.

**Files:**
- Create: `src/lib/scraping/scrape-usage.ts`

**Step 1: Create the file**

```typescript
// Haiku pricing per 1M tokens (as of 2025)
const HAIKU_INPUT_PRICE_PER_M = 0.80;
const HAIKU_OUTPUT_PRICE_PER_M = 4.00;

// Sonnet pricing per 1M tokens
const SONNET_INPUT_PRICE_PER_M = 3.00;
const SONNET_OUTPUT_PRICE_PER_M = 15.00;

const USD_TO_GBP = 0.79;

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface UsageSummary {
  totalCalls: number;
  filterLinksCalls: number;
  classifyPageCalls: number;
  extractionCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costGbp: number;
}

function costForUsage(usage: AiUsage): number {
  const isHaiku = usage.model.includes("haiku");
  const inputPrice = isHaiku ? HAIKU_INPUT_PRICE_PER_M : SONNET_INPUT_PRICE_PER_M;
  const outputPrice = isHaiku ? HAIKU_OUTPUT_PRICE_PER_M : SONNET_OUTPUT_PRICE_PER_M;
  return (
    (usage.inputTokens / 1_000_000) * inputPrice +
    (usage.outputTokens / 1_000_000) * outputPrice
  );
}

export class CrawlUsageTracker {
  private filterLinksCalls = 0;
  private classifyPageCalls = 0;
  private extractionCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;

  addFilterLinks(usage: AiUsage): void {
    this.filterLinksCalls++;
    this.addUsage(usage);
  }

  addClassifyPage(usage: AiUsage): void {
    this.classifyPageCalls++;
    this.addUsage(usage);
  }

  addExtraction(usage: AiUsage): void {
    this.extractionCalls++;
    this.addUsage(usage);
  }

  private addUsage(usage: AiUsage): void {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.costUsd += costForUsage(usage);
  }

  getSummary(): UsageSummary {
    return {
      totalCalls: this.filterLinksCalls + this.classifyPageCalls + this.extractionCalls,
      filterLinksCalls: this.filterLinksCalls,
      classifyPageCalls: this.classifyPageCalls,
      extractionCalls: this.extractionCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsd: Math.round(this.costUsd * 1_000_000) / 1_000_000,
      costGbp: Math.round(this.costUsd * USD_TO_GBP * 1_000_000) / 1_000_000,
    };
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/scraping/scrape-usage.ts
git commit -m "feat: add crawl usage tracker for AI token costs"
```

---

### Task 4: Create filter-links.ts — Haiku link filtering

Uses Haiku with tool_use to decide which links on a page are worth following for festival data.

**Files:**
- Create: `src/lib/ai/filter-links.ts`

**Step 1: Create the file**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface LinkCandidate {
  url: string;
  text: string;
  context: string;
}

export interface FilterLinksResult {
  selectedIndices: number[];
  selected: LinkCandidate[];
  usage: AiUsage;
}

const filterLinksTool: Anthropic.Messages.Tool = {
  name: "select_relevant_links",
  description: "Select which links are likely to lead to festival lineup, info, or poster pages",
  input_schema: {
    type: "object" as const,
    properties: {
      relevant_indices: {
        type: "array",
        items: { type: "number" },
        description: "0-based indices of links worth following",
      },
    },
    required: ["relevant_indices"],
  },
};

export async function filterLinksForFestival(
  links: LinkCandidate[]
): Promise<FilterLinksResult> {
  if (links.length === 0) {
    return { selectedIndices: [], selected: [], usage: { inputTokens: 0, outputTokens: 0, model: "claude-haiku-4-5-20251001" } };
  }

  const linksDescription = links
    .map(
      (link, i) =>
        `[${i}] URL: ${link.url}\n    Text: "${link.text}"\n    Context: "${link.context}"`
    )
    .join("\n\n");

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    tools: [filterLinksTool],
    tool_choice: { type: "tool", name: "select_relevant_links" },
    messages: [
      {
        role: "user",
        content: `You are analyzing links from a music festival website. Select which links are likely to lead to pages containing:
- Festival lineup / artists / performers / acts
- Festival info: dates, location, venue, about
- Tickets (often contain dates and pricing)
- Programme / schedule / stages / days

Do NOT select links about:
- Contact, privacy, terms, news, blog, press, careers
- Login, shop/merch, social media, accessibility, FAQs, cookies
- External sites, sponsors, partners

When unsure, include the link (false positives are cheap).

Links to analyze:

${linksDescription}`,
      },
    ],
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return { selectedIndices: [], selected: [], usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, model: "claude-haiku-4-5-20251001" } };
  }

  const input = toolBlock.input as { relevant_indices: number[] };
  const indices = (input.relevant_indices || []).filter(
    (i) => i >= 0 && i < links.length
  );

  return {
    selectedIndices: indices,
    selected: indices.map((i) => links[i]),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-haiku-4-5-20251001",
    },
  };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/ai/filter-links.ts
git commit -m "feat: add Haiku link filtering for festival crawl"
```

---

### Task 5: Create classify-page.ts — Haiku page classification

Uses Haiku with tool_use to classify a fetched page as lineup, info, poster_only, or irrelevant.

**Files:**
- Create: `src/lib/ai/classify-page.ts`

**Step 1: Create the file**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type PageCategory = "lineup" | "info" | "poster_only" | "irrelevant";

export interface ClassifyPageResult {
  category: PageCategory;
  confidence: number;
  usage: AiUsage;
}

const classifyPageTool: Anthropic.Messages.Tool = {
  name: "classify_page",
  description: "Classify a festival website page by its content type",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: ["lineup", "info", "poster_only", "irrelevant"],
        description:
          "lineup = page lists artist/band names as its primary content. info = page contains festival dates, location, venue, or description but not a lineup. poster_only = page has no structured lineup or info text but likely contains poster images. irrelevant = none of the above.",
      },
      confidence: {
        type: "number",
        description: "Confidence score between 0 and 1",
      },
    },
    required: ["category", "confidence"],
  },
};

export async function classifyPage(
  text: string,
  jsonLd: string | null,
  hasImages: boolean
): Promise<ClassifyPageResult> {
  let content = `Classify this festival website page.\n\n`;
  if (jsonLd) {
    content += `JSON-LD structured data:\n${jsonLd}\n\n`;
  }
  content += `Page text (first 3000 chars):\n${text.slice(0, 3000)}`;
  if (hasImages) {
    content += `\n\n[Note: This page contains large images that could be festival posters]`;
  }

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
    tools: [classifyPageTool],
    tool_choice: { type: "tool", name: "classify_page" },
    messages: [{ role: "user", content }],
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return {
      category: "irrelevant",
      confidence: 0,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, model: "claude-haiku-4-5-20251001" },
    };
  }

  const input = toolBlock.input as { category: PageCategory; confidence: number };

  return {
    category: input.category,
    confidence: input.confidence ?? 0,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-haiku-4-5-20251001",
    },
  };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/ai/classify-page.ts
git commit -m "feat: add Haiku page classification for festival crawl"
```

---

### Task 6: Create extract-festival.ts — Haiku final structured extraction from text

Assembles collected text from lineup + info pages and extracts structured festival data. This replaces the old `extractFromPage` in `scraping.ts`.

**Files:**
- Create: `src/lib/ai/extract-festival.ts`
- Reference: `src/lib/extraction.ts` (same `ExtractionResult` interface)

**Step 1: Create the file**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "@/lib/extraction";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MAX_CONTENT_LENGTH = 30_000;

export interface TextExtractionResponse {
  extraction: ExtractionResult;
  usage: AiUsage;
}

const extractFestivalTool: Anthropic.Messages.Tool = {
  name: "extract_festival_info",
  description: "Extract structured festival information from website text",
  input_schema: {
    type: "object" as const,
    properties: {
      festival_name: { type: "string", description: "Name of the festival" },
      dates: {
        type: "object",
        properties: {
          start: { type: "string", description: "Start date in YYYY-MM-DD format" },
          end: { type: "string", description: "End date in YYYY-MM-DD format" },
        },
        required: ["start", "end"],
      },
      location: {
        type: "string",
        description: "Location — venue name, town, area, or combination. Empty string if unknown.",
      },
      region: {
        type: "string",
        description: "UK region (e.g. South East England, Scotland, Wales). Empty string if unknown.",
      },
      website_url: {
        type: "string",
        description: "Festival website URL if found. Empty string if unknown.",
      },
      artists: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Artist or band name" },
            billing: {
              type: "string",
              enum: ["headliner", "support"],
              description: "headliner = most prominent/top-billed, support = all others",
            },
          },
          required: ["name", "billing"],
        },
        description: "All artists/bands found across the pages",
      },
    },
    required: ["festival_name", "dates", "location", "region", "website_url", "artists"],
  },
};

export async function extractFestivalFromText(
  lineupContent: { url: string; text: string }[],
  infoContent: { url: string; text: string }[],
  websiteUrl: string
): Promise<TextExtractionResponse> {
  let assembled = "";

  for (const page of infoContent) {
    assembled += `--- Source: ${page.url} ---\n${page.text}\n\n`;
  }
  for (const page of lineupContent) {
    assembled += `--- Source: ${page.url} ---\n${page.text}\n\n`;
  }

  if (assembled.length > MAX_CONTENT_LENGTH) {
    assembled = assembled.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated]";
  }

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    tools: [extractFestivalTool],
    tool_choice: { type: "tool", name: "extract_festival_info" },
    messages: [
      {
        role: "user",
        content: `Extract all festival information from these web pages scraped from ${websiteUrl}.

${assembled}

Rules:
- Extract the festival name, dates, location, region, and website URL
- List ALL artists/bands found across the pages
- "headliner" = most prominent/top-billed acts, "support" = all other artists
- Do NOT include stage names, venue areas, sponsors, or generic text as artists
- If an artist name includes featuring/collaboration (e.g. "Artist A feat. Artist B"), split into SEPARATE entries with the same billing
- If dates are unclear, use your best estimate. If year is missing, assume 2026
- If any field is unclear, use an empty string`,
      },
    ],
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("No tool_use block in AI response");
  }

  return {
    extraction: toolBlock.input as ExtractionResult,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-haiku-4-5-20251001",
    },
  };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/ai/extract-festival.ts
git commit -m "feat: add Haiku text extraction for festival data"
```

---

### Task 7: Create crawl-festival.ts — the BFS crawler

The core crawler that ties everything together. Adapted from projectBidWriter's `crawl-criteria.ts`.

**Files:**
- Create: `src/lib/scraping/crawl-festival.ts`
- Reference: projectBidWriter's `app/src/lib/scraping/crawl-criteria.ts` for BFS pattern

**Step 1: Create the file**

```typescript
import { scrapeUrl, normalizeUrl, hashContent, type LinkWithContext, type ImageCandidate } from "./scrape-url";
import { filterLinksForFestival } from "@/lib/ai/filter-links";
import { classifyPage, type PageCategory } from "@/lib/ai/classify-page";
import { extractFestivalFromText } from "@/lib/ai/extract-festival";
import { extractFromPoster, type ExtractionResult } from "@/lib/extraction";
import { CrawlUsageTracker, type UsageSummary } from "./scrape-usage";
import { supabaseAdmin } from "@/lib/supabase";

const MAX_DEPTH = 3;
const MAX_PAGES = 10;
const MAX_AI_CALLS = 20;

export type CrawlStage =
  | "fetching"
  | "filtering"
  | "crawling"
  | "classifying"
  | "extracting"
  | "poster_fallback"
  | "complete"
  | "error";

export interface CrawlProgress {
  stage: CrawlStage;
  message: string;
  pageTree: PageNode[];
  currentPage?: number;
  totalPages?: number;
  usage?: UsageSummary;
}

export interface PageNode {
  url: string;
  title: string;
  category: PageCategory | "pending";
  children: PageNode[];
}

export interface CrawlResult {
  extraction: ExtractionResult;
  source: "text" | "poster";
  lineupUrl: string | null;
  posterPageUrl: string | null;
  posterImageUrl: string | null;
  usage: UsageSummary;
  pageTree: PageNode;
  pagesScraped: number;
}

interface CrawlOptions {
  onProgress?: (progress: CrawlProgress) => void;
  signal?: AbortSignal;
}

export async function crawlFestival(
  startUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const { onProgress, signal } = options;
  const usageTracker = new CrawlUsageTracker();
  const visitedUrls = new Set<string>();
  let totalScraped = 0;
  let totalAiCalls = 0;

  // Content buckets
  const lineupContent: { url: string; text: string }[] = [];
  const infoContent: { url: string; text: string }[] = [];
  const posterImages: { pageUrl: string; imageUrl: string }[] = [];

  // Track which URL was identified as the lineup page
  let discoveredLineupUrl: string | null = null;
  let discoveredPosterPageUrl: string | null = null;

  // Page tree
  const pageNodes = new Map<string, PageNode>();
  const startDomain = new URL(startUrl).hostname;

  function isAllowedUrl(url: string): boolean {
    try {
      return new URL(url).hostname === startDomain;
    } catch {
      return false;
    }
  }

  function getOrCreateNode(url: string, title: string, category: PageCategory | "pending"): PageNode {
    const existing = pageNodes.get(url);
    if (existing) {
      if (category !== "pending") existing.category = category;
      return existing;
    }
    const node: PageNode = { url, title, category, children: [] };
    pageNodes.set(url, node);
    return node;
  }

  function emit(progress: Omit<CrawlProgress, "pageTree">) {
    const rootNode = pageNodes.get(normalizeUrl(startUrl));
    onProgress?.({
      ...progress,
      pageTree: rootNode ? [rootNode] : [],
    });
  }

  // BFS queue
  interface QueueEntry {
    links: LinkWithContext[];
    depth: number;
    sourceUrl: string;
  }
  const bfsQueue: QueueEntry[] = [];

  // --- Start crawl ---
  const normalizedStart = normalizeUrl(startUrl);
  visitedUrls.add(normalizedStart);
  totalScraped++;

  emit({ stage: "fetching", message: "Fetching homepage..." });

  const rootResult = await scrapeUrl(startUrl);
  const rootNode = getOrCreateNode(normalizedStart, rootResult.title, "pending");

  // Collect root page content as info (homepage usually has festival details)
  if (rootResult.text.length > 50) {
    infoContent.push({ url: startUrl, text: rootResult.text });
  }

  // Collect root page images
  for (const img of rootResult.images) {
    posterImages.push({ pageUrl: startUrl, imageUrl: img.src });
  }

  // Seed BFS queue
  if (rootResult.links.length > 0) {
    bfsQueue.push({ links: rootResult.links, depth: 0, sourceUrl: normalizedStart });
  }

  // --- Process BFS queue ---
  while (bfsQueue.length > 0 && totalScraped < MAX_PAGES) {
    if (signal?.aborted) break;
    if (totalAiCalls >= MAX_AI_CALLS) break;

    const { links, depth, sourceUrl } = bfsQueue.shift()!;
    if (links.length === 0) continue;

    // Filter to same domain
    const sameDomainLinks = links.filter((l) => isAllowedUrl(l.url));
    if (sameDomainLinks.length === 0) continue;

    // AI: filter links
    emit({
      stage: "filtering",
      message: `Analyzing ${sameDomainLinks.length} links...`,
      usage: usageTracker.getSummary(),
    });

    const filterResult = await filterLinksForFestival(sameDomainLinks);
    usageTracker.addFilterLinks(filterResult.usage);
    totalAiCalls++;

    for (const link of filterResult.selected) {
      if (signal?.aborted) break;
      if (totalAiCalls >= MAX_AI_CALLS) break;
      if (totalScraped >= MAX_PAGES) break;

      const normalizedLinkUrl = normalizeUrl(link.url);
      if (visitedUrls.has(normalizedLinkUrl)) continue;
      visitedUrls.add(normalizedLinkUrl);
      totalScraped++;

      emit({
        stage: "crawling",
        message: `Fetching: ${link.text || link.url} (page ${totalScraped}/${MAX_PAGES})`,
        currentPage: totalScraped,
        totalPages: MAX_PAGES,
        usage: usageTracker.getSummary(),
      });

      let pageResult;
      try {
        pageResult = await scrapeUrl(link.url);
      } catch {
        continue;
      }

      // AI: classify page
      emit({
        stage: "classifying",
        message: `Classifying: ${link.text || link.url}...`,
        usage: usageTracker.getSummary(),
      });

      const classification = await classifyPage(
        pageResult.text,
        pageResult.jsonLd,
        pageResult.images.length > 0
      );
      usageTracker.addClassifyPage(classification.usage);
      totalAiCalls++;

      // Add to page tree
      const childNode = getOrCreateNode(normalizedLinkUrl, link.text || pageResult.title, classification.category);
      const parentNode = pageNodes.get(sourceUrl);
      if (parentNode) parentNode.children.push(childNode);

      emit({
        stage: "classifying",
        message: `${link.text || link.url}: ${classification.category} (${(classification.confidence * 100).toFixed(0)}%)`,
        usage: usageTracker.getSummary(),
      });

      // Collect content by category
      switch (classification.category) {
        case "lineup":
          lineupContent.push({ url: link.url, text: pageResult.text });
          if (!discoveredLineupUrl) discoveredLineupUrl = link.url;
          break;
        case "info":
          infoContent.push({ url: link.url, text: pageResult.text });
          break;
        case "poster_only":
          if (!discoveredPosterPageUrl) discoveredPosterPageUrl = link.url;
          break;
      }

      // Collect images from any page
      for (const img of pageResult.images) {
        posterImages.push({ pageUrl: link.url, imageUrl: img.src });
      }

      // Enqueue child links
      if (depth + 1 < MAX_DEPTH && pageResult.links.length > 0) {
        bfsQueue.push({ links: pageResult.links, depth: depth + 1, sourceUrl: normalizedLinkUrl });
      }
    }
  }

  // --- Extract festival data ---
  let extraction: ExtractionResult;
  let source: "text" | "poster";
  let posterImageUrl: string | null = null;

  if (lineupContent.length > 0 || infoContent.length > 0) {
    // Text-based extraction
    emit({
      stage: "extracting",
      message: `Extracting festival details from ${lineupContent.length + infoContent.length} page(s)...`,
      usage: usageTracker.getSummary(),
    });

    const textResult = await extractFestivalFromText(lineupContent, infoContent, startUrl);
    usageTracker.addExtraction(textResult.usage);
    extraction = textResult.extraction;
    source = "text";
  } else if (posterImages.length > 0) {
    // Poster fallback
    emit({
      stage: "poster_fallback",
      message: "No HTML lineup found. Extracting from poster image...",
      usage: usageTracker.getSummary(),
    });

    // Pick the first poster image (og:image preferred, already first in array)
    const bestPoster = posterImages[0];
    posterImageUrl = bestPoster.imageUrl;
    if (!discoveredPosterPageUrl) discoveredPosterPageUrl = bestPoster.pageUrl;

    const posterResult = await extractFromPoster(bestPoster.imageUrl);
    usageTracker.addExtraction(posterResult.usage);
    extraction = posterResult.extraction;
    source = "poster";
  } else {
    throw new Error(
      "Could not find any lineup, festival info, or poster images on this website."
    );
  }

  // If poster was found, download and store in Supabase
  if (posterImages.length > 0) {
    const bestPoster = posterImages[0];
    try {
      const imgResponse = await fetch(bestPoster.imageUrl);
      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
      const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const fileName = `posters/${Date.now()}-crawled.${ext}`;

      await supabaseAdmin.storage
        .from("festival-posters")
        .upload(fileName, imgBuffer, { contentType });

      const { data: publicUrlData } = supabaseAdmin.storage
        .from("festival-posters")
        .getPublicUrl(fileName);

      posterImageUrl = publicUrlData.publicUrl;
    } catch {
      // Non-fatal — keep the external URL
      posterImageUrl = bestPoster.imageUrl;
    }
  }

  const finalUsage = usageTracker.getSummary();

  emit({
    stage: "complete",
    message: `Done. Scraped ${totalScraped} page(s), found ${extraction.artists.length} artists.`,
    usage: finalUsage,
  });

  return {
    extraction,
    source,
    lineupUrl: discoveredLineupUrl,
    posterPageUrl: discoveredPosterPageUrl,
    posterImageUrl,
    usage: finalUsage,
    pageTree: rootNode,
    pagesScraped: totalScraped,
  };
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: add BFS festival website crawler"
```

---

### Task 8: Create SSE API endpoint — scrape-festival route

**Files:**
- Create: `src/app/api/admin/scrape-festival/route.ts`
- Reference: projectBidWriter's `app/src/app/api/admin/scrape-criteria/route.ts` for SSE pattern

**Step 1: Create the file**

```typescript
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { crawlFestival, type CrawlProgress } from "@/lib/scraping/crawl-festival";

let activeScrape = false;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { url: string; festivalId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.url) {
    return new Response(JSON.stringify({ error: "Missing url" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (activeScrape) {
    return new Response(
      JSON.stringify({ error: "A scrape is already in progress. Please wait." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  const abortController = new AbortController();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      activeScrape = true;

      function sendEvent(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          abortController.abort();
        }
      }

      try {
        const result = await crawlFestival(body.url, {
          signal: abortController.signal,
          onProgress: (progress: CrawlProgress) => {
            sendEvent("progress", progress);
          },
        });

        // Log API usage
        await prisma.apiUsageLog.create({
          data: {
            model: result.source === "poster" ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            festivalId: body.festivalId || null,
            festivalName: result.extraction.festival_name || null,
            success: true,
          },
        });

        // If updating existing festival, save crawl metadata
        if (body.festivalId) {
          await prisma.festival.update({
            where: { id: body.festivalId },
            data: {
              lineupUrl: result.lineupUrl,
              posterPageUrl: result.posterPageUrl,
              lastScrapedAt: new Date(),
              ...(result.lineupUrl
                ? { lineupHash: null } // Will be set by cron on first re-check
                : {}),
            },
          });
        }

        sendEvent("complete", {
          extraction: result.extraction,
          source: result.source,
          lineupUrl: result.lineupUrl,
          posterPageUrl: result.posterPageUrl,
          posterImageUrl: result.posterImageUrl,
          usage: result.usage,
          pageTree: result.pageTree,
          pagesScraped: result.pagesScraped,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          sendEvent("error", {
            message: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        }
      } finally {
        activeScrape = false;
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
      activeScrape = false;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/admin/scrape-festival/route.ts
git commit -m "feat: add SSE endpoint for festival website crawler"
```

---

### Task 9: Create scrape-progress.tsx — shared SSE progress UI component

Shared component used by both the new festival form and the edit page. Handles SSE connection, progress log rendering, and page tree display.

**Files:**
- Create: `src/app/admin/festivals/scrape-progress.tsx`

**Step 1: Create the file**

```tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ExtractionResult } from "@/lib/extraction";

interface PageNode {
  url: string;
  title: string;
  category: "lineup" | "info" | "poster_only" | "irrelevant" | "pending";
  children: PageNode[];
}

interface UsageSummary {
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costGbp: number;
}

interface CrawlCompleteData {
  extraction: ExtractionResult;
  source: "text" | "poster";
  lineupUrl: string | null;
  posterPageUrl: string | null;
  posterImageUrl: string | null;
  usage: UsageSummary;
  pageTree: PageNode;
  pagesScraped: number;
}

interface ScrapeProgressProps {
  onComplete: (data: CrawlCompleteData) => void;
  onError: (message: string) => void;
  festivalId?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  lineup: "text-green-600",
  info: "text-blue-600",
  poster_only: "text-purple-600",
  irrelevant: "text-gray-400",
  pending: "text-gray-300",
};

const CATEGORY_ICONS: Record<string, string> = {
  lineup: "[L]",
  info: "[I]",
  poster_only: "[P]",
  irrelevant: "[-]",
  pending: "[.]",
};

function PageTreeNode({ node, depth = 0 }: { node: PageNode; depth?: number }) {
  const indent = depth * 16;
  const colorClass = CATEGORY_COLORS[node.category] || "text-gray-400";
  const icon = CATEGORY_ICONS[node.category] || "[ ]";

  // Show just the pathname for readability
  let displayUrl = node.title || node.url;
  try {
    displayUrl = node.title || new URL(node.url).pathname;
  } catch { /* keep as-is */ }

  return (
    <div>
      <div className="flex items-center gap-1 text-xs font-mono" style={{ paddingLeft: indent }}>
        <span className={colorClass}>{icon}</span>
        <span className={`${colorClass} truncate`} title={node.url}>
          {displayUrl}
        </span>
      </div>
      {node.children.map((child, i) => (
        <PageTreeNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ScrapeProgress({ onComplete, onError, festivalId }: ScrapeProgressProps) {
  const [url, setUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [pageTree, setPageTree] = useState<PageNode[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg]);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  function handleScrape() {
    if (!url.trim() || scraping) return;

    setScraping(true);
    setLogs([]);
    setPageTree(null);
    setUsage(null);

    // Use fetch with SSE parsing since EventSource doesn't support POST
    const abortController = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/admin/scrape-festival", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), festivalId }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const data = await res.json();
          onError(data.error || "Scraping failed");
          setScraping(false);
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));
                if (currentEvent === "progress") {
                  addLog(data.message);
                  if (data.pageTree) setPageTree(data.pageTree);
                  if (data.usage) setUsage(data.usage);
                } else if (currentEvent === "complete") {
                  addLog(data.pagesScraped
                    ? `Complete: scraped ${data.pagesScraped} pages, found ${data.extraction.artists.length} artists (${data.source})`
                    : "Complete");
                  onComplete(data);
                } else if (currentEvent === "error") {
                  addLog(`Error: ${data.message}`);
                  onError(data.message);
                }
              } catch { /* ignore parse errors */ }
              currentEvent = "";
            }
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          onError("Connection lost. Please try again.");
        }
      } finally {
        setScraping(false);
      }
    })();

    // Store abort controller for cleanup
    eventSourceRef.current = { close: () => abortController.abort() } as unknown as EventSource;
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="festivalUrl" className="block text-sm font-medium text-gray-700">
            Festival Website URL
          </label>
          <input
            id="festivalUrl"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://glastonbury.co.uk"
            disabled={scraping}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={handleScrape}
          disabled={scraping || !url.trim()}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {scraping ? "Scraping..." : "Scrape Festival"}
        </button>
      </div>

      {/* Progress log */}
      {logs.length > 0 && (
        <div
          ref={logRef}
          className="bg-gray-900 text-gray-100 rounded p-3 text-xs font-mono max-h-48 overflow-y-auto space-y-0.5"
        >
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}

      {/* Usage stats */}
      {usage && (
        <div className="flex gap-4 text-xs text-gray-500">
          <span>{usage.totalCalls} AI calls</span>
          <span>{(usage.inputTokens + usage.outputTokens).toLocaleString()} tokens</span>
          <span>${usage.costUsd.toFixed(4)}</span>
        </div>
      )}

      {/* Page tree */}
      {pageTree && pageTree.length > 0 && (
        <div className="bg-gray-50 rounded p-3">
          <h4 className="text-xs font-medium text-gray-600 mb-2">Pages explored</h4>
          <div className="text-xs text-gray-500 mb-2 flex gap-3">
            <span className="text-green-600">[L] Lineup</span>
            <span className="text-blue-600">[I] Info</span>
            <span className="text-purple-600">[P] Poster</span>
            <span className="text-gray-400">[-] Irrelevant</span>
          </div>
          {pageTree.map((node, i) => (
            <PageTreeNode key={i} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/admin/festivals/scrape-progress.tsx
git commit -m "feat: add SSE progress component for festival crawler"
```

---

### Task 10: Update new-festival-form.tsx — unified scrape flow

Replace the poster upload + lineup URL sections with the unified ScrapeProgress component.

**Files:**
- Modify: `src/app/admin/festivals/new/new-festival-form.tsx`

**Step 1: Rewrite the form**

Replace the entire file. The key changes:
- Remove poster upload logic (`handleUpload`, `handleExtract`)
- Remove lineup URL scraping logic (`handleScrapeUrl`)
- Add `ScrapeProgress` component as Step 1
- Pre-fill form from crawl results (same fields as before)
- Add `posterImageUrl`, `lineupUrl`, `posterPageUrl` as hidden fields
- Keep "Skip — enter details manually" link
- Keep manual artist editing

The form should:
1. Import `ScrapeProgress` from `../scrape-progress`
2. In `onComplete` callback: set all form state from `data.extraction` (name, dates, location, region, website, artists), plus `data.posterImageUrl`, `data.lineupUrl`, `data.posterPageUrl`
3. Show poster preview if `posterImageUrl` is set
4. Pass `lineupUrl` and `posterPageUrl` as hidden inputs to the `createFestival` server action
5. The "Skip — enter details manually" link should just scroll to / reveal the form section

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Manual test**

Run: `npm run dev`
- Navigate to `/admin/festivals/new`
- Verify the ScrapeProgress component appears with URL input
- Verify "Skip" link shows the manual form
- If you have a test festival URL, run a full scrape and verify form pre-fills

**Step 4: Commit**

```bash
git add src/app/admin/festivals/new/new-festival-form.tsx
git commit -m "feat: replace poster upload + lineup URL with unified crawler in new form"
```

---

### Task 11: Update scrape-section.tsx — full re-scrape on edit page

Replace the lineup-only scrape section with the full crawler using ScrapeProgress.

**Files:**
- Modify: `src/app/admin/festivals/[id]/scrape-section.tsx`
- Modify: `src/app/admin/festivals/[id]/page.tsx` (pass `websiteUrl` and `posterPageUrl`)

**Step 1: Update scrape-section.tsx**

Replace with a component that:
- Uses `ScrapeProgress` with `festivalId` prop
- On complete: shows extracted artists for review, with a "Save Artists" button
- Also shows if name/dates/location differ from current festival data (informational)
- Reuses `saveScrapedArtists` from `@/lib/actions/scrape`

Props needed: `festivalId`, `websiteUrl`, `lastScrapedAt`

Pre-fill the URL input in ScrapeProgress with the existing `websiteUrl`.

**Step 2: Update the edit page**

In `src/app/admin/festivals/[id]/page.tsx`, ensure `websiteUrl` and `posterPageUrl` are passed to the ScrapeSection component from the festival query.

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/app/admin/festivals/[id]/scrape-section.tsx src/app/admin/festivals/[id]/page.tsx
git commit -m "feat: replace lineup-only scrape with full crawler on edit page"
```

---

### Task 12: Update createFestival server action — accept new fields

**Files:**
- Modify: `src/lib/actions/festival.ts`

**Step 1: Update the action**

Add `lineupUrl`, `posterPageUrl`, and `posterImageUrl` to the fields parsed from FormData in `createFestival`. Save them to the database on festival creation.

Look at the existing `createFestival` function to see how it currently handles `lineupUrl` and `posterImageUrl` — extend it with `posterPageUrl`.

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/actions/festival.ts
git commit -m "feat: save posterPageUrl from crawler in createFestival"
```

---

### Task 13: Update cron job — handle poster-page re-checking

**Files:**
- Modify: `src/app/api/cron/scrape-lineups/route.ts`

**Step 1: Add poster-page re-check logic**

After the existing loop that processes festivals with `lineupUrl`, add a second query for festivals that have `posterPageUrl` but no `lineupUrl`. For each:

1. Fetch the `posterPageUrl`
2. Extract image URLs from the page (use `scrapeUrl` from `src/lib/scraping/scrape-url.ts`)
3. Hash the sorted image URL list
4. Compare against `lineupHash` (reuse this field — it's a content hash regardless of source)
5. If changed:
   - Pick the first/best image
   - Run through `extractFromPoster` (Sonnet vision)
   - Merge new artists (same logic as existing)
   - Update hash and timestamp
6. If unchanged: just update `lastScrapedAt`

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/api/cron/scrape-lineups/route.ts
git commit -m "feat: add poster-page re-checking to cron job"
```

---

### Task 14: Delete old scraping files

**Files:**
- Delete: `src/app/api/admin/scrape-lineup/route.ts`
- Delete: `src/lib/scraping.ts`

**Step 1: Check for any remaining imports of the old files**

Run: `grep -r "scrape-lineup\|from.*lib/scraping" src/ --include="*.ts" --include="*.tsx" -l`

Fix any remaining imports:
- `src/app/api/cron/scrape-lineups/route.ts` should now import from `@/lib/scraping/scrape-url` and `@/lib/ai/extract-festival`
- Any other files still importing from `@/lib/scraping` need updating

**Step 2: Delete old files**

```bash
rm src/app/api/admin/scrape-lineup/route.ts
rm src/lib/scraping.ts
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove old scraping files replaced by crawler"
```

---

### Task 15: End-to-end manual test

**Step 1: Run the dev server**

Run: `npm run dev`

**Step 2: Test new festival flow**

1. Go to `/admin/festivals/new`
2. Paste a festival URL (e.g. a known UK festival website)
3. Watch SSE progress log populate
4. Verify page tree shows with correct category colors
5. Verify form pre-fills with extracted data
6. Verify artists list appears with headliner/support labels
7. If poster was found, verify poster preview appears
8. Submit the form and verify festival is created

**Step 3: Test "Skip" manual entry**

1. Go to `/admin/festivals/new`
2. Click "Skip — enter details manually"
3. Fill in form manually, verify it still works

**Step 4: Test edit page re-scrape**

1. Go to an existing festival's edit page
2. Click "Re-scrape from Website"
3. Verify crawler runs and shows new/updated artists

**Step 5: Test error cases**

1. Try an invalid URL — should show error
2. Try while another scrape is running — should show 429 message
3. Try a site that requires JavaScript — should fail gracefully

**Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found in end-to-end testing"
```
