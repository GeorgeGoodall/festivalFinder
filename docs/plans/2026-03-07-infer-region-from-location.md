# Infer Region from Location Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** After festival extraction, make a cheap Haiku call to map the scraped `location` string to one of the 12 canonical UK regions when region is missing or unrecognised.

**Architecture:** A new `inferRegionFromLocation` function in `src/lib/ai/infer-region.ts` follows the same pattern as the existing AI helpers (`classify-page`, `filter-links`). It is called in `crawl-festival.ts` after step 4 (extraction) when `extraction.location` is non-empty and `extraction.region` is blank or not in `UK_REGIONS`. Usage is tracked via a new `addInferRegion` method on `CrawlUsageTracker`.

**Tech Stack:** Anthropic SDK (claude-haiku-4-5-20251001), TypeScript, existing `AiUsage` / `UK_REGIONS` types.

---

### Task 1: Add `addInferRegion` to `CrawlUsageTracker`

**Files:**
- Modify: `src/lib/scraping/scrape-usage.ts`

**Step 1: Add the private array and public method**

In `CrawlUsageTracker`, after the existing `extractionUsages` array, add:

```ts
private inferRegionUsages: AiUsage[] = [];
```

After `addExtraction`, add:

```ts
addInferRegion(usage: AiUsage): void {
  this.inferRegionUsages.push(usage);
}
```

**Step 2: Include in `getSummary`**

Update the `allUsages` spread to include `...this.inferRegionUsages`.

The `getSummary` block currently reads:
```ts
const allUsages = [
  ...this.filterLinksUsages,
  ...this.classifyPageUsages,
  ...this.extractionUsages,
];
```

Change to:
```ts
const allUsages = [
  ...this.filterLinksUsages,
  ...this.classifyPageUsages,
  ...this.extractionUsages,
  ...this.inferRegionUsages,
];
```

**Step 3: Commit**

```bash
git add src/lib/scraping/scrape-usage.ts
git commit -m "feat: track infer-region AI usage in CrawlUsageTracker"
```

---

### Task 2: Create `src/lib/ai/infer-region.ts`

**Files:**
- Create: `src/lib/ai/infer-region.ts`

**Step 1: Write the file**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { UK_REGIONS } from "@/lib/constants";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface InferRegionResult {
  region: string;
  usage: AiUsage;
}

const REGIONS_LIST = UK_REGIONS.join(", ");

export async function inferRegionFromLocation(
  location: string
): Promise<InferRegionResult> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 32,
    messages: [
      {
        role: "user",
        content: `Which UK region does this festival location belong to?

Location: "${location}"

Valid regions: ${REGIONS_LIST}

Reply with ONLY the exact region name from the list above, or "unknown" if you cannot determine it. No explanation.`,
      },
    ],
  });

  const raw =
    message.content[0].type === "text" ? message.content[0].text.trim() : "";

  // Validate against the known list (case-insensitive match → use canonical casing)
  const matched = UK_REGIONS.find(
    (r) => r.toLowerCase() === raw.toLowerCase()
  );

  return {
    region: matched ?? "",
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-haiku-4-5-20251001",
    },
  };
}
```

**Step 2: Commit**

```bash
git add src/lib/ai/infer-region.ts
git commit -m "feat: add inferRegionFromLocation AI helper"
```

---

### Task 3: Call `inferRegionFromLocation` in the crawl pipeline

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

**Step 1: Import the new function**

Add to the existing imports at the top of `crawl-festival.ts`:

```ts
import { inferRegionFromLocation } from "@/lib/ai/infer-region";
import { UK_REGIONS } from "@/lib/constants";
```

**Step 2: Add region inference after step 4 (extraction)**

The extraction block ends just before the poster storage section (step 5). After `source = "text"` or `source = "poster"` is set, add a new block:

```ts
// -----------------------------------------------------------------------
// 4b. Infer region from location if needed
// -----------------------------------------------------------------------

if (
  extraction.location &&
  (!extraction.region ||
    !(UK_REGIONS as readonly string[]).includes(extraction.region))
) {
  emit({
    stage: "extracting",
    message: "Inferring UK region from location...",
    usage: tracker.getSummary(),
  });

  try {
    const regionResult = await inferRegionFromLocation(extraction.location);
    tracker.addInferRegion(regionResult.usage);
    if (regionResult.region) {
      extraction.region = regionResult.region;
    }
  } catch {
    // Non-fatal: leave region as-is
  }
}
```

Place this block between the closing `}` of the `if/else if/else` extraction block and the `// 5. Poster storage` comment.

**Step 3: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: infer UK region from scraped location in crawl pipeline"
```

---

### Task 4: Manual smoke test

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Navigate to the new festival form**

Open `http://localhost:3000/admin/festivals/new`, enter a UK festival URL (e.g. `https://truckfestival.com/`), and start the crawl.

**Step 3: Verify region is populated**

After crawl completes, check that the Region field in the form is pre-filled with a value from the UK_REGIONS list (e.g. "South West"). If location was detected but region was blank before, it should now be filled in.

**Step 4: Check usage counter**

The scrape progress panel should show one additional AI call attributed to region inference.
