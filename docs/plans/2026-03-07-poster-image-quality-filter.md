# Poster Image Quality Filter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instead of picking the first image from the winning priority bucket, iterate through all candidates in priority order and select the first one that passes both a minimum file size check (≥50KB) and minimum dimension check (≥400×400px). Add detailed server and UI logging throughout.

**Architecture:** Two changes — (1) install `image-size` package for dimension parsing, (2) refactor the poster selection loop in `crawl-festival.ts` to track source page per image, iterate candidates with quality checks, and emit progress events. The `PosterCandidate` wrapper type (local to crawl-festival.ts) carries the image plus its source page URL and classification.

**Tech Stack:** TypeScript, Next.js 16, `image-size` npm package (lightweight header parser)

---

### Task 1: Install image-size package

**Files:**
- Modify: `package.json` (via npm install)

**Step 1: Install the package**

```bash
cd "C:\Users\eorge\Documents\workspace\festivalFinder"
npm install image-size
```

**Step 2: Verify it installed**

```bash
node -e "const s = require('image-size'); console.log('ok', typeof s.imageSize)"
```

Expected: `ok function`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add image-size package for poster dimension checking"
```

---

### Task 2: Refactor poster candidate tracking and selection with quality checks and logging

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

#### Context

Current state after previous refactor:
- Four buckets: `posterPageImages`, `lineupImages`, `fallbackImages`, `ogImage`
- Selection: `posterPageImages[0] ?? lineupImages[0] ?? fallbackImages[0] ?? ogImage`
- One download attempt, no size/dimension checks
- No per-image logging

#### What we're building

A `PosterCandidate` type (local interface, top of file) that wraps an `ImageCandidate` with source info:

```ts
interface PosterCandidate {
  img: ImageCandidate;
  sourcePage: string;        // URL of page it was found on
  sourceClassification: string; // "poster_only" | "lineup" | "fallback" | "og"
}
```

Replace the four flat arrays with four typed arrays of `PosterCandidate[]` (except `ogImage` which becomes `PosterCandidate | null`).

At selection time: build a flat ordered array of all candidates, iterate, and pick the first that passes quality checks.

#### Step 1: Add the PosterCandidate interface

Add after the existing imports, before the constants block:

```ts
interface PosterCandidate {
  img: ImageCandidate;
  sourcePage: string;
  sourceClassification: string;
}
```

#### Step 2: Add "poster_search" to CrawlStage

Find:
```ts
export type CrawlStage =
  | "fetching"
  | "filtering"
  | "crawling"
  | "classifying"
  | "extracting"
  | "poster_fallback"
  | "complete"
  | "error";
```

Add `| "poster_search"` before `| "poster_fallback"`.

#### Step 3: Update bucket declarations

Find the four bucket declarations (around line 119-122):
```ts
const posterPageImages: ImageCandidate[] = [];
const lineupImages: ImageCandidate[] = [];
const fallbackImages: ImageCandidate[] = [];
let ogImage: ImageCandidate | null = null;
```

Replace with:
```ts
const posterPageImages: PosterCandidate[] = [];
const lineupImages: PosterCandidate[] = [];
const fallbackImages: PosterCandidate[] = [];
let ogImage: PosterCandidate | null = null;
```

#### Step 4: Update homepage image collection

Find the homepage image loop:
```ts
for (const img of homepage.images) {
  if (img.alt === "og:image") {
    if (!ogImage) ogImage = img;
  } else {
    fallbackImages.push(img);
  }
}
```

Replace with:
```ts
const homepagePath = (() => { try { return new URL(homepage.url).pathname; } catch { return homepage.url; } })();
for (const img of homepage.images) {
  if (img.alt === "og:image") {
    if (!ogImage) ogImage = { img, sourcePage: homepage.url, sourceClassification: "og" };
  } else {
    fallbackImages.push({ img, sourcePage: homepage.url, sourceClassification: "fallback" });
  }
}
console.log(`[poster] Homepage (${homepagePath}): ${homepage.images.filter(i => i.alt !== "og:image").length} image(s) collected`);
```

#### Step 5: Update crawled-page image collection

Find the crawled-page image routing loop:
```ts
for (const img of page.images) {
  if (img.alt === "og:image") {
    if (!ogImage) ogImage = img;
    continue;
  }
  if (classification === "poster_only") {
    posterPageImages.push(img);
  } else if (classification === "lineup") {
    lineupImages.push(img);
  } else {
    fallbackImages.push(img);
  }
}
```

Note: check what variable holds the classification result for the current page — it may be named `classification`, `category`, or `result.category`. Read surrounding code first.

Replace with:
```ts
const pagePath = (() => { try { return new URL(page.url).pathname; } catch { return page.url; } })();
const nonOgImages = page.images.filter(i => i.alt !== "og:image");
const ogImages = page.images.filter(i => i.alt === "og:image");

for (const img of ogImages) {
  if (!ogImage) ogImage = { img, sourcePage: page.url, sourceClassification: "og" };
}

for (const img of nonOgImages) {
  if (classification === "poster_only") {
    posterPageImages.push({ img, sourcePage: page.url, sourceClassification: "poster_only" });
  } else if (classification === "lineup") {
    lineupImages.push({ img, sourcePage: page.url, sourceClassification: "lineup" });
  } else {
    fallbackImages.push({ img, sourcePage: page.url, sourceClassification: "fallback" });
  }
}

if (nonOgImages.length > 0) {
  console.log(`[poster] Page "${pagePath}" (${classification}): ${nonOgImages.length} image(s)`, nonOgImages.map(i => i.src));
}
```

#### Step 6: Replace the bestImage selection with iterative quality-checked selection

Replace the entire poster storage section (section 5, from `const bestImage =` through the end of the upload try/catch block) with:

```ts
// -----------------------------------------------------------------------
// 5. Poster storage — iterate candidates in priority order, pick first
//    that passes size (≥50KB) and dimension (≥400×400px) checks
// -----------------------------------------------------------------------

const MIN_BYTES = 50 * 1024;   // 50 KB
const MIN_DIM = 400;            // px

import { imageSize } from "image-size";

const allCandidates: PosterCandidate[] = [
  ...posterPageImages,
  ...lineupImages,
  ...fallbackImages,
  ...(ogImage ? [ogImage] : []),
];

console.log(`[poster] ${allCandidates.length} total candidate(s) across all buckets`);
emit({
  stage: "poster_search",
  message: `Searching for poster — ${allCandidates.length} candidate image(s) found`,
  pageTree: [],
  usage: tracker.getSummary(),
});

let posterImageUrl: string | null = null;

for (const candidate of allCandidates) {
  const src = candidate.img.src;
  const srcPath = (() => { try { return new URL(src).pathname; } catch { return src; } })();
  const pagePathLabel = (() => { try { return new URL(candidate.sourcePage).pathname; } catch { return candidate.sourcePage; } })();

  console.log(`[poster] Checking "${srcPath}" from ${pagePathLabel} (${candidate.sourceClassification})`);

  let imgResponse: Response;
  try {
    imgResponse = await fetch(src);
  } catch (err) {
    console.warn(`[poster] Skipping "${srcPath}": fetch failed —`, err);
    continue;
  }

  const contentType = imgResponse.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    console.warn(`[poster] Skipping "${srcPath}": non-image content-type "${contentType}"`);
    continue;
  }

  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

  if (imgBuffer.length < MIN_BYTES) {
    console.log(`[poster] Skipping "${srcPath}": too small (${Math.round(imgBuffer.length / 1024)}KB < 50KB)`);
    continue;
  }

  let dims: { width?: number; height?: number } = {};
  try {
    dims = imageSize(imgBuffer);
  } catch {
    console.warn(`[poster] Could not read dimensions for "${srcPath}", skipping`);
    continue;
  }

  const w = dims.width ?? 0;
  const h = dims.height ?? 0;
  if (w < MIN_DIM || h < MIN_DIM) {
    console.log(`[poster] Skipping "${srcPath}": dimensions too small (${w}×${h} < ${MIN_DIM}×${MIN_DIM})`);
    continue;
  }

  console.log(`[poster] Selected "${srcPath}" (${Math.round(imgBuffer.length / 1024)}KB, ${w}×${h}) from ${pagePathLabel}`);
  emit({
    stage: "poster_search",
    message: `Selected poster from ${pagePathLabel} (${Math.round(imgBuffer.length / 1024)}KB, ${w}×${h}px)`,
    pageTree: [],
    usage: tracker.getSummary(),
  });

  const ext = getExtensionFromUrl(src);
  const filename = `crawled-${Date.now()}${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("posters")
    .upload(filename, imgBuffer, { contentType, upsert: false });

  if (!error) {
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("posters")
      .getPublicUrl(filename);
    posterImageUrl = publicUrl;
  } else {
    console.error("[poster] Supabase upload failed:", error);
  }

  break; // stop after first successful candidate
}

if (!posterImageUrl && allCandidates.length > 0) {
  // Fall back to external URL of best candidate (don't upload)
  posterImageUrl = allCandidates[0].img.src;
  console.warn("[poster] No candidate passed quality checks — using external URL as fallback:", posterImageUrl);
  emit({
    stage: "poster_search",
    message: "No suitable poster image found — using external URL as fallback",
    pageTree: [],
    usage: tracker.getSummary(),
  });
}
```

**Important:** The `import { imageSize } from "image-size"` must go at the top of the file with the other imports, not inside the function. Move it there.

Also remove the old `extractFromPoster` fallback reference to `bestImage` / `bestImageForExtraction` if it still exists — search for these and update to use `allCandidates[0]?.img.src` instead.

#### Step 7: Fix extractFromPoster fallback

The poster fallback extraction (section 4, before the poster storage section) still uses `bestImage`. Update it to use:

```ts
const bestImageForExtraction = (
  posterPageImages[0] ?? lineupImages[0] ?? fallbackImages[0] ?? ogImage
)?.img ?? null;
```

And update the `extractFromPoster` call:
```ts
const posterResult = await extractFromPoster(bestImageForExtraction.src);
```

And the `else if` guard:
```ts
} else if (bestImageForExtraction) {
```

#### Step 8: Verify TypeScript

```bash
cd "C:\Users\eorge\Documents\workspace\festivalFinder"
npx tsc --noEmit
```

Fix any errors before committing.

#### Step 9: Commit

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: add size and dimension quality checks for poster image selection

Iterate candidates in priority order, skip images under 50KB or
smaller than 400x400px. Add detailed console and UI progress logging
for each candidate checked and the final selected image."
```
