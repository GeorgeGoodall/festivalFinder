# Poster Image Ranking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat `posterImages` array in the festival scraper with four priority buckets so lineup/poster-page images are preferred over the `og:image` social banner.

**Architecture:** Single file change in `crawl-festival.ts`. Split image collection into four buckets (`posterPageImages`, `lineupImages`, `homepageImages`, `ogImage`) keyed by source page classification. At selection time, pick the first image from the highest-priority non-empty bucket.

**Tech Stack:** TypeScript, Next.js 16 App Router, Cheerio (scraping), Gemini AI (page classification)

---

### Task 1: Replace flat array with four priority buckets

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

The current code has one flat array (`posterImages`) that receives all images. It puts `og:image` first, so it always wins. We replace it with four buckets and change every place images are pushed into.

**Step 1: Replace the array declaration**

Find this block (around line 117–121):
```ts
const posterImages: ImageCandidate[] = [];
let discoveredLineupUrl: string | null = null;
let discoveredPosterPageUrl: string | null = null;
```

Replace with:
```ts
const posterPageImages: ImageCandidate[] = [];   // from poster_only pages (best)
const lineupImages: ImageCandidate[] = [];        // from lineup pages
const homepageImages: ImageCandidate[] = [];      // <img> elements from homepage
let ogImage: ImageCandidate | null = null;        // og:image fallback (worst)
let discoveredLineupUrl: string | null = null;
let discoveredPosterPageUrl: string | null = null;
```

**Step 2: Update the homepage image collection**

Find this block (around line 153–156):
```ts
infoContent.push({ url: homepage.url, text: homepage.text });

// Collect images from homepage
posterImages.push(...homepage.images);
```

Replace with:
```ts
infoContent.push({ url: homepage.url, text: homepage.text });

// Collect images from homepage — split og:image from real <img> elements
for (const img of homepage.images) {
  if (img.alt === "og:image") {
    ogImage = img;
  } else {
    homepageImages.push(img);
  }
}
```

**Step 3: Update the crawled-page image collection**

Find this block (around line 280–281):
```ts
// Always collect images from any page
posterImages.push(...page.images);
```

Replace with:
```ts
// Route images to priority buckets based on page classification
for (const img of page.images) {
  if (img.alt === "og:image") {
    ogImage = img; // capture as fallback
    continue;
  }
  if (classification === "poster_only") {
    posterPageImages.push(img);
  } else if (classification === "lineup") {
    lineupImages.push(img);
  } else {
    homepageImages.push(img);
  }
}
```

Note: `classification` is the variable holding the result of `classifyPage(...)` for the current page. Check the surrounding code to confirm the exact variable name used.

**Step 4: Replace the `extractFromPoster` fallback call**

Find (around line 316–324):
```ts
} else if (posterImages.length > 0) {
  emit({
    stage: "poster_fallback",
    message: "No HTML lineup found. Extracting from poster image...",
    usage: tracker.getSummary(),
  });

  const posterResult = await extractFromPoster(posterImages[0].src);
```

Replace with:
```ts
const bestImageForExtraction =
  posterPageImages[0] ?? lineupImages[0] ?? homepageImages[0] ?? ogImage ?? null;

} else if (bestImageForExtraction) {
  emit({
    stage: "poster_fallback",
    message: "No HTML lineup found. Extracting from poster image...",
    usage: tracker.getSummary(),
  });

  const posterResult = await extractFromPoster(bestImageForExtraction.src);
```

**Step 5: Replace the poster upload block**

Find (around line 363–364):
```ts
let posterImageUrl: string | null =
  posterImages.length > 0 ? posterImages[0].src : null;

if (posterImages.length > 0) {
  try {
    const bestImage = posterImages[0];
```

Replace with:
```ts
const bestImage =
  posterPageImages[0] ?? lineupImages[0] ?? homepageImages[0] ?? ogImage ?? null;

let posterImageUrl: string | null = bestImage?.src ?? null;

if (bestImage) {
  try {
```

**Step 6: Fix the remaining reference inside the upload block**

A few lines after the block above, find:
```ts
      const ext = getExtensionFromUrl(bestImage.src);
```

This line already uses `bestImage` so no change needed — but verify the closing brace structure still works after your edits (the `if (bestImage)` replaces `if (posterImages.length > 0)`).

**Step 7: Verify the file compiles**

```bash
cd "C:\Users\eorge\Documents\workspace\festivalFinder"
npx tsc --noEmit
```

Expected: no errors. Fix any type errors before continuing.

**Step 8: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: rank poster images by source page classification

Prefer images from poster_only and lineup pages over homepage images
and og:image. og:image is now a last resort, not the default pick."
```
