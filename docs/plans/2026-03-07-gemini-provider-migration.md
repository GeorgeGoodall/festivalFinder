# Gemini Provider Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the 4 scraping AI files to Gemini 2.5 Flash, keeping Claude available via `AI_PROVIDER` env var.

**Architecture:** Move current Anthropic implementations verbatim into `src/lib/ai/providers/claude/`. Create matching Gemini implementations in `src/lib/ai/providers/gemini/`. The existing 4 top-level files become thin routers that import from both and dispatch based on `process.env.AI_PROVIDER` (default: `"gemini"`).

**Tech Stack:** `@google/generative-ai` (Gemini SDK), `@anthropic-ai/sdk` (kept for Claude), Next.js server-side env vars.

---

### Task 1: Install Gemini SDK and add env var

**Files:**
- Modify: `package.json`
- Modify: `.env.local`

**Step 1: Install the Gemini SDK**

```bash
npm install @google/generative-ai
```

Expected: package installs, `package.json` and `package-lock.json` updated.

**Step 2: Add env var to `.env.local`**

Open `.env.local` and add this line at the bottom:

```
AI_PROVIDER=gemini
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @google/generative-ai sdk"
```

---

### Task 2: Move Claude implementations to providers/claude/

**Files:**
- Create: `src/lib/ai/providers/claude/classify-page.ts`
- Create: `src/lib/ai/providers/claude/extract-festival.ts`
- Create: `src/lib/ai/providers/claude/filter-links.ts`
- Create: `src/lib/ai/providers/claude/infer-region.ts`

Copy each current file verbatim into the matching provider path. No logic changes.

**Step 1: Create `src/lib/ai/providers/claude/classify-page.ts`**

Copy the entire contents of `src/lib/ai/classify-page.ts` into the new file. No changes needed.

**Step 2: Create `src/lib/ai/providers/claude/extract-festival.ts`**

Copy the entire contents of `src/lib/ai/extract-festival.ts` into the new file. No changes needed.

**Step 3: Create `src/lib/ai/providers/claude/filter-links.ts`**

Copy the entire contents of `src/lib/ai/filter-links.ts` into the new file. No changes needed.

**Step 4: Create `src/lib/ai/providers/claude/infer-region.ts`**

Copy the entire contents of `src/lib/ai/infer-region.ts` into the new file. No changes needed.

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors from the new provider files (they are identical to the originals which already compiled).

**Step 6: Commit**

```bash
git add src/lib/ai/providers/
git commit -m "refactor: move Claude AI implementations to providers/claude/"
```

---

### Task 3: Create Gemini implementation — infer-region

This is the simplest step: plain text generation, no function calling.

**Files:**
- Create: `src/lib/ai/providers/gemini/infer-region.ts`

**Step 1: Create the file**

```ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { UK_REGIONS } from "@/lib/constants";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

export interface InferRegionResult {
  region: string;
  usage: AiUsage;
}

const MODEL = "gemini-2.5-flash";

const REGIONS_LIST = UK_REGIONS.join(", ");

export async function inferRegionFromLocation(
  location: string
): Promise<InferRegionResult> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: MODEL });

  const result = await model.generateContent(
    `Which UK region does this festival location belong to?

Location: "${location}"

Valid regions: ${REGIONS_LIST}

Reply with ONLY the exact region name from the list above, or "unknown" if you cannot determine it. No explanation.`
  );

  const raw = result.response.text().trim();

  const matched = UK_REGIONS.find(
    (r) => r.toLowerCase() === raw.toLowerCase()
  );

  return {
    region: matched ?? "",
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/ai/providers/gemini/infer-region.ts
git commit -m "feat: add Gemini infer-region provider"
```

---

### Task 4: Create Gemini implementation — classify-page

Uses Gemini function calling with forced tool call to match current Anthropic tool_use behavior.

**Files:**
- Create: `src/lib/ai/providers/gemini/classify-page.ts`

**Step 1: Create the file**

```ts
import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

export type PageCategory = "lineup" | "info" | "poster_only" | "irrelevant";

export interface ClassifyPageResult {
  category: PageCategory;
  confidence: number;
  usage: AiUsage;
}

const MODEL = "gemini-2.5-flash";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const model = genAI.getGenerativeModel({
  model: MODEL,
  tools: [
    {
      functionDeclarations: [
        {
          name: "classify_page",
          description:
            "Classify the type of festival web page based on its content.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              category: {
                type: SchemaType.STRING,
                enum: ["lineup", "info", "poster_only", "irrelevant"],
                description:
                  "lineup = page lists artist/band names as primary content. " +
                  "info = page contains festival dates, location, venue, description but not a lineup. " +
                  "poster_only = page has no structured lineup or info text but likely contains poster images. " +
                  "irrelevant = none of the above.",
              },
              confidence: {
                type: SchemaType.NUMBER,
                description:
                  "Confidence score between 0 and 1 for the classification.",
              },
            },
            required: ["category", "confidence"],
          },
        },
      ],
    },
  ],
  toolConfig: {
    functionCallingConfig: {
      mode: FunctionCallingMode.ANY,
      allowedFunctionNames: ["classify_page"],
    },
  },
});

export async function classifyPage(
  text: string,
  jsonLd: string | null,
  hasImages: boolean
): Promise<ClassifyPageResult> {
  let userContent = "";
  if (jsonLd) {
    userContent += `JSON-LD metadata:\n${jsonLd}\n\n`;
  }
  userContent += `Page text (first 3000 chars):\n${text.slice(0, 3000)}`;
  if (hasImages) {
    userContent += "\n\nNote: this page also contains images.";
  }

  const result = await model.generateContent(userContent);
  const call = result.response.functionCalls()?.[0];

  const usage: AiUsage = {
    inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
    model: MODEL,
  };

  if (!call) {
    return { category: "irrelevant", confidence: 0, usage };
  }

  const args = call.args as { category: PageCategory; confidence: number };

  return {
    category: args.category,
    confidence: args.confidence,
    usage,
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/ai/providers/gemini/classify-page.ts
git commit -m "feat: add Gemini classify-page provider"
```

---

### Task 5: Create Gemini implementation — filter-links

**Files:**
- Create: `src/lib/ai/providers/gemini/filter-links.ts`

**Step 1: Create the file**

```ts
import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

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

const MODEL = "gemini-2.5-flash";

export async function filterLinksForFestival(
  links: LinkCandidate[]
): Promise<FilterLinksResult> {
  if (links.length === 0) {
    return {
      selectedIndices: [],
      selected: [],
      usage: { inputTokens: 0, outputTokens: 0, model: MODEL },
    };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [
      {
        functionDeclarations: [
          {
            name: "select_relevant_links",
            description:
              "Select the indices of links that are relevant to discovering festival information.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                relevant_indices: {
                  type: SchemaType.ARRAY,
                  items: { type: SchemaType.NUMBER },
                  description: "Array of indices of relevant links",
                },
              },
              required: ["relevant_indices"],
            },
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: ["select_relevant_links"],
      },
    },
  });

  const numberedList = links
    .map(
      (link, i) =>
        `[${i}] URL: ${link.url} Text: "${link.text}" Context: "${link.context}"`
    )
    .join("\n");

  const result = await model.generateContent(
    `You are filtering links found on a music festival website. Select the links most likely to lead to useful festival information.

INCLUDE links leading to:
- Lineup / artists / performers / acts
- About / info pages
- Tickets
- Programme / schedule / stages / days

EXCLUDE links leading to:
- Contact, privacy, terms, news, blog, press, careers
- Login, shop/merch, social media
- Accessibility, FAQs, cookies

When unsure, include the link (false positives are cheap).

Here are the links:
${numberedList}`
  );

  const call = result.response.functionCalls()?.[0];
  let selectedIndices: number[] = [];
  if (call) {
    const input = call.args as { relevant_indices: number[] };
    selectedIndices = input.relevant_indices.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < links.length
    );
  }

  const selected = selectedIndices.map((i) => links[i]);

  return {
    selectedIndices,
    selected,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/lib/ai/providers/gemini/filter-links.ts
git commit -m "feat: add Gemini filter-links provider"
```

---

### Task 6: Create Gemini implementation — extract-festival

**Files:**
- Create: `src/lib/ai/providers/gemini/extract-festival.ts`

**Step 1: Create the file**

```ts
import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";
import type { ExtractionResult } from "@/lib/extraction";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const MODEL = "gemini-2.5-flash";
const MAX_CONTENT_LENGTH = 30_000;

export interface TextExtractionResponse {
  extraction: ExtractionResult;
  usage: AiUsage;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const model = genAI.getGenerativeModel({
  model: MODEL,
  tools: [
    {
      functionDeclarations: [
        {
          name: "extract_festival_info",
          description:
            "Extract structured festival information from website text content",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              festival_name: {
                type: SchemaType.STRING,
                description: "Name of the festival",
              },
              dates: {
                type: SchemaType.OBJECT,
                properties: {
                  start: {
                    type: SchemaType.STRING,
                    description: "Start date in YYYY-MM-DD format",
                  },
                  end: {
                    type: SchemaType.STRING,
                    description: "End date in YYYY-MM-DD format",
                  },
                },
                required: ["start", "end"],
              },
              location: {
                type: SchemaType.STRING,
                description:
                  "Location of the festival - could be a venue name, town, area, or combination (e.g. 'Worthy Farm, Pilton, Somerset' or 'Victoria Park, London'). Use whatever location info is available, or empty string",
              },
              region: {
                type: SchemaType.STRING,
                description:
                  "UK region (e.g. South East England, Scotland, Wales), or empty string",
              },
              website_url: {
                type: SchemaType.STRING,
                description:
                  "Website URL if found in content, or empty string",
              },
              artists: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    name: {
                      type: SchemaType.STRING,
                      description: "Artist or band name",
                    },
                    billing: {
                      type: SchemaType.STRING,
                      enum: ["headliner", "support"],
                      description:
                        "headliner = largest/most prominent names, support = all other artists",
                    },
                  },
                  required: ["name", "billing"],
                },
                description: "All artists/bands identified across the pages",
              },
            },
            required: [
              "festival_name",
              "dates",
              "location",
              "region",
              "website_url",
              "artists",
            ],
          },
        },
      ],
    },
  ],
  toolConfig: {
    functionCallingConfig: {
      mode: FunctionCallingMode.ANY,
      allowedFunctionNames: ["extract_festival_info"],
    },
  },
});

export async function extractFestivalFromText(
  lineupContent: { url: string; text: string }[],
  infoContent: { url: string; text: string }[],
  websiteUrl: string
): Promise<TextExtractionResponse> {
  const parts: string[] = [];
  for (const page of infoContent) {
    parts.push(`--- Source: ${page.url} ---\n${page.text}`);
  }
  for (const page of lineupContent) {
    parts.push(`--- Source: ${page.url} ---\n${page.text}`);
  }

  let assembled = parts.join("\n\n");
  if (assembled.length > MAX_CONTENT_LENGTH) {
    assembled = assembled.slice(0, MAX_CONTENT_LENGTH);
  }

  const result = await model.generateContent(
    `Analyze the following festival website content and extract all festival information.

The festival website is: ${websiteUrl}

Rules:
- Extract the festival name, dates, location, region, and website URL
- List ALL artists/bands found across the pages
- "headliner" = most prominent/top-billed artists, "support" = all other artists
- Do NOT include stage names, venue areas, sponsors, or generic text as artists
- If an artist name includes a featuring/collaboration (e.g. "Artist A feat. Artist B", "Artist A ft. Artist B", "Artist A x Artist B", "Artist A & Artist B", "Artist A b2b Artist B"), split them into SEPARATE artist entries with the same billing level
- If dates are unclear, use your best estimate. If year is missing, assume 2026
- If any field is unclear, use an empty string

Website content:

${assembled}`
  );

  const call = result.response.functionCalls()?.[0];
  if (!call) {
    throw new Error("No function call in Gemini response");
  }

  return {
    extraction: call.args as ExtractionResult,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/lib/ai/providers/gemini/extract-festival.ts
git commit -m "feat: add Gemini extract-festival provider"
```

---

### Task 7: Update the 4 top-level AI files to be thin routers

Replace each of the 4 original files with a thin router. The router imports from both providers and dispatches based on `AI_PROVIDER` env var at runtime.

**Files:**
- Modify: `src/lib/ai/classify-page.ts`
- Modify: `src/lib/ai/extract-festival.ts`
- Modify: `src/lib/ai/filter-links.ts`
- Modify: `src/lib/ai/infer-region.ts`

**Step 1: Replace `src/lib/ai/classify-page.ts`**

```ts
import { classifyPage as classifyPageGemini } from "./providers/gemini/classify-page";
import { classifyPage as classifyPageClaude } from "./providers/claude/classify-page";

export type { ClassifyPageResult, PageCategory } from "./providers/gemini/classify-page";

export function classifyPage(
  ...args: Parameters<typeof classifyPageGemini>
): ReturnType<typeof classifyPageGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude"
    ? classifyPageClaude(...args)
    : classifyPageGemini(...args);
}
```

**Step 2: Replace `src/lib/ai/extract-festival.ts`**

```ts
import { extractFestivalFromText as extractGemini } from "./providers/gemini/extract-festival";
import { extractFestivalFromText as extractClaude } from "./providers/claude/extract-festival";

export type { TextExtractionResponse } from "./providers/gemini/extract-festival";

export function extractFestivalFromText(
  ...args: Parameters<typeof extractGemini>
): ReturnType<typeof extractGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude" ? extractClaude(...args) : extractGemini(...args);
}
```

**Step 3: Replace `src/lib/ai/filter-links.ts`**

```ts
import { filterLinksForFestival as filterGemini } from "./providers/gemini/filter-links";
import { filterLinksForFestival as filterClaude } from "./providers/claude/filter-links";

export type { FilterLinksResult, LinkCandidate } from "./providers/gemini/filter-links";

export function filterLinksForFestival(
  ...args: Parameters<typeof filterGemini>
): ReturnType<typeof filterGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude" ? filterClaude(...args) : filterGemini(...args);
}
```

**Step 4: Replace `src/lib/ai/infer-region.ts`**

```ts
import { inferRegionFromLocation as inferGemini } from "./providers/gemini/infer-region";
import { inferRegionFromLocation as inferClaude } from "./providers/claude/infer-region";

export type { InferRegionResult } from "./providers/gemini/infer-region";

export function inferRegionFromLocation(
  ...args: Parameters<typeof inferGemini>
): ReturnType<typeof inferGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude" ? inferClaude(...args) : inferGemini(...args);
}
```

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. All call sites in the rest of the codebase import from these files and will continue to work unchanged.

**Step 6: Commit**

```bash
git add src/lib/ai/classify-page.ts src/lib/ai/extract-festival.ts src/lib/ai/filter-links.ts src/lib/ai/infer-region.ts
git commit -m "refactor: convert top-level AI files to provider routers"
```

---

### Task 8: Update cost tracking for Gemini 2.5 Flash

**Files:**
- Modify: `src/lib/scraping/scrape-usage.ts:19-31`

**Step 1: Update `computeCost` in `scrape-usage.ts`**

Replace the pricing constants and `computeCost` function:

```ts
// Pricing per million tokens (USD)
const HAIKU_INPUT_PER_M = 0.8;
const HAIKU_OUTPUT_PER_M = 4.0;
const SONNET_INPUT_PER_M = 3.0;
const SONNET_OUTPUT_PER_M = 15.0;
// Gemini 2.5 Flash (verify at https://ai.google.dev/pricing)
const GEMINI_FLASH_INPUT_PER_M = 0.15;
const GEMINI_FLASH_OUTPUT_PER_M = 3.50;
const USD_TO_GBP = 0.79;

function computeCost(inputTokens: number, outputTokens: number, model: string): number {
  const m = model.toLowerCase();
  if (m.includes("gemini")) {
    const inputCost = (inputTokens / 1_000_000) * GEMINI_FLASH_INPUT_PER_M;
    const outputCost = (outputTokens / 1_000_000) * GEMINI_FLASH_OUTPUT_PER_M;
    return inputCost + outputCost;
  }
  const isHaiku = m.includes("haiku");
  const inputCost = (inputTokens / 1_000_000) * (isHaiku ? HAIKU_INPUT_PER_M : SONNET_INPUT_PER_M);
  const outputCost = (outputTokens / 1_000_000) * (isHaiku ? HAIKU_OUTPUT_PER_M : SONNET_OUTPUT_PER_M);
  return inputCost + outputCost;
}
```

> Note: Gemini 2.5 Flash pricing may change — verify the current rate at https://ai.google.dev/pricing before going live.

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/lib/scraping/scrape-usage.ts
git commit -m "feat: add Gemini 2.5 Flash pricing to cost tracker"
```

---

### Task 9: Smoke test end-to-end

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Run a scrape via the admin UI**

Navigate to the admin scrape page, enter a festival URL, and trigger a scrape. Confirm it completes without errors.

**Step 3: Verify token counts appear in the usage summary**

The scrape progress/result view shows `inputTokens` and `outputTokens`. Confirm they are non-zero (Gemini populates `usageMetadata`).

**Step 4: Verify provider swap works**

In `.env.local`, change `AI_PROVIDER=claude`, restart dev server, run another scrape. Confirm it still works. Then set back to `gemini`.

---
