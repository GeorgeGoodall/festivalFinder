# Image Picker for Festival Creation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single auto-selected poster with a full image picker on the new-festival creation screen, letting admins select lineup poster(s) and logo from all images found during the crawl, with per-image AI artist extraction as a manual fallback.

**Architecture:** The crawler stops uploading images to Supabase (except the logo, which stays for the edit-festival path). It returns all found images as external URLs plus an algorithm pick. The admin UI shows a grid picker after scraping. On festival save, only selected images are uploaded.

**Tech Stack:** Next.js App Router, React state, Supabase Storage, existing `/api/admin/extract-poster` route, Prisma, Tailwind CSS v4.

---

## Task 1: Update `CrawlResult` — add `imageCandidates`, remove `posterImageUrl`

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

**Context:** Currently the crawl fetches every candidate image, checks 400×400 + 50KB, uploads the first passing one to Supabase as `crawled-*.png`, and returns `posterImageUrl` (a Supabase URL). We are removing this upload entirely. The logo upload (from the favicon) stays — it is still used by the edit-festival scrape path.

**Step 1: Update the `CrawlResult` interface**

Replace the current interface fields:

```typescript
// REMOVE:
posterImageUrl: string | null;

// ADD:
imageCandidates: ImageCandidate[];   // all images found, as external URLs
algorithmPosterSrc: string | null;   // algorithm's best guess (external URL)
```

`logoImageUrl` stays in `CrawlResult` (still uploaded during crawl for edit path).

Add a new exported interface above `CrawlResult`:

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

**Step 2: Remove the `imageSize` import**

`imageSize` was only used in the poster upload loop. Remove it:

```typescript
// DELETE this line:
import { imageSize } from "image-size";
```

**Step 3: Change `MIN_DIM` to 800**

```typescript
// In the Constants section, change:
const MIN_BYTES = 50 * 1024;   // keep — used for algorithm pick check
const MIN_DIM = 800;            // was 400
```

Note: `MIN_BYTES` and `MIN_DIM` are now only used for `algorithmPosterSrc` selection, not for filtering the `imageCandidates` list.

**Step 4: Update `source` type**

Change the `source` variable declaration in the extraction section (already done in a previous session but double-check it reads):

```typescript
let source: "text" | "poster" | "text+poster";
```

**Step 5: Collect all images into a flat `imageCandidates` array**

After the BFS loop completes (before the extraction section), build the flat list. Insert after the closing `}` of the BFS while loop:

```typescript
// Build flat imageCandidates list from all buckets
const imageCandidates: ImageCandidate[] = [
  ...posterPageImages.map((c) => ({
    src: c.img.src,
    alt: c.img.alt,
    sourcePage: c.sourcePage,
    sourceClassification: "poster_only" as const,
    width: c.img.width,
    height: c.img.height,
  })),
  ...lineupImages.map((c) => ({
    src: c.img.src,
    alt: c.img.alt,
    sourcePage: c.sourcePage,
    sourceClassification: "lineup" as const,
    width: c.img.width,
    height: c.img.height,
  })),
  ...fallbackImages.map((c) => ({
    src: c.img.src,
    alt: c.img.alt,
    sourcePage: c.sourcePage,
    sourceClassification: "fallback" as const,
    width: c.img.width,
    height: c.img.height,
  })),
  ...(ogImage
    ? [{
        src: ogImage.img.src,
        alt: ogImage.img.alt,
        sourcePage: ogImage.sourcePage,
        sourceClassification: "og" as const,
        width: ogImage.img.width,
        height: ogImage.img.height,
      }]
    : []),
];

// Add favicon as a candidate if present
if (homepage.faviconUrl) {
  imageCandidates.push({
    src: homepage.faviconUrl,
    alt: "favicon",
    sourcePage: homepage.url,
    sourceClassification: "favicon",
    width: null,
    height: null,
  });
}
```

**Step 6: Compute `algorithmPosterSrc` without fetching**

Replace the entire **Step 5 (poster storage)** block — the big `for (const candidate of allCandidates)` loop that fetches, checks, and uploads — with this:

```typescript
// -----------------------------------------------------------------------
// 5. Algorithm poster pick — choose best candidate without fetching.
//    Prefer images with known large dimensions or no dimension info.
//    Priority order is already encoded in imageCandidates order.
// -----------------------------------------------------------------------

let algorithmPosterSrc: string | null = null;

const MIN_DIM = 800;

for (const candidate of imageCandidates) {
  if (candidate.sourceClassification === "favicon") continue;

  const w = candidate.width ?? 0;
  const h = candidate.height ?? 0;
  const hasDimensions = candidate.width !== null || candidate.height !== null;

  // Skip if dimensions are known and too small
  if (hasDimensions && (w < MIN_DIM || h < MIN_DIM)) continue;

  algorithmPosterSrc = candidate.src;
  break;
}
```

**Step 7: Remove the logo upload block reference from `posterImageUrl`**

The logo upload block (currently labelled "Logo extraction") stays unchanged. Keep it as-is.

Find the existing `let posterImageUrl: string | null = null;` declaration and remove it entirely (it was set inside the old upload loop and returned).

**Step 8: Update the return value**

In the `return` statement at the bottom, replace `posterImageUrl` with the new fields:

```typescript
return {
  extraction,
  source,
  lineupUrl: discoveredLineupUrl,
  posterPageUrl: discoveredPosterPageUrl,
  imageCandidates,           // NEW
  algorithmPosterSrc,        // NEW
  // posterImageUrl removed
  lineupPending,
  logoImageUrl,              // unchanged
  usage,
  pageTree: rootNode,
  pagesScraped: totalScraped,
};
```

**Step 9: Run TypeScript check**

```bash
cd "C:\Users\eorge\Documents\workspace\festivalFinder" && npx tsc --noEmit 2>&1
```

Expected: errors referencing `posterImageUrl` on `CrawlResult` in other files — these are fixed in subsequent tasks.

**Step 10: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: collect all image candidates in crawl, remove poster auto-upload"
```

---

## Task 2: Update SSE route to match new `CrawlResult`

**Files:**
- Modify: `src/app/api/admin/scrape-festival/route.ts`

**Context:** The route sends a `complete` SSE event with the crawl result. It also creates a `ScrapeLog`. It has an edit-path block (when `festivalId` provided) that saves the logo — this stays unchanged.

**Step 1: Update the SSE `complete` event**

Find the `sendEvent("complete", { ... })` call. Replace `posterImageUrl` with `imageCandidates` and `algorithmPosterSrc`:

```typescript
sendEvent("complete", {
  scrapeLogId: scrapeLog.id,
  extraction: result.extraction,
  source: result.source,
  lineupUrl: result.lineupUrl,
  posterPageUrl: result.posterPageUrl,
  imageCandidates: result.imageCandidates,       // NEW
  algorithmPosterSrc: result.algorithmPosterSrc, // NEW
  // posterImageUrl: removed
  lineupPending: result.lineupPending,
  logoImageUrl: result.logoImageUrl,             // unchanged
  usage: result.usage,
  pageTree: result.pageTree,
  pagesScraped: result.pagesScraped,
});
```

**Step 2: Update `ScrapeLog` creation**

The `ScrapeLog` create call currently doesn't reference `posterImageUrl` (we already removed it in a previous session), so no change needed there.

**Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: errors now only in `scrape-progress.tsx` and `new-festival-form.tsx`.

**Step 4: Commit**

```bash
git add src/app/api/admin/scrape-festival/route.ts
git commit -m "feat: update SSE complete event with imageCandidates"
```

---

## Task 3: Update `CrawlCompleteData` interface and `new-festival-form.tsx`

**Files:**
- Modify: `src/app/admin/festivals/scrape-progress.tsx`
- Modify: `src/app/admin/festivals/new/new-festival-form.tsx`

**Step 1: Update `CrawlCompleteData` in `scrape-progress.tsx`**

The `ImageCandidate` type needs to be defined here too (or imported). Add it as a local interface, then update `CrawlCompleteData`:

```typescript
interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
}

interface CrawlCompleteData {
  scrapeLogId: string;
  extraction: { ... };            // unchanged
  source: "text" | "poster" | "text+poster";
  lineupUrl: string | null;
  posterPageUrl: string | null;
  imageCandidates: ImageCandidate[];    // NEW
  algorithmPosterSrc: string | null;   // NEW
  // posterImageUrl: REMOVED
  lineupPending: boolean;
  logoImageUrl: string | null;         // unchanged
  usage: { ... };
  pageTree: PageNode;
  pagesScraped: number;
}
```

**Step 2: Update `new-festival-form.tsx` — remove old poster state**

In `new-festival-form.tsx`:

Remove:
```typescript
const [posterImageUrl, setPosterImageUrl] = useState<string | null>(null);
```

Add:
```typescript
const [imageCandidates, setImageCandidates] = useState<ImageCandidate[]>([]);
const [algorithmPosterSrc, setAlgorithmPosterSrc] = useState<string | null>(null);
const [showImagePicker, setShowImagePicker] = useState(false);
const [selectedPosterSrcs, setSelectedPosterSrcs] = useState<string[]>([]);
const [selectedLogoSrc, setSelectedLogoSrc] = useState<string | null>(null);
```

Add the `ImageCandidate` interface at the top of the file (same shape as in `scrape-progress.tsx`).

**Step 3: Update the `onComplete` handler**

```typescript
onComplete={(data) => {
  setError(null);
  const ext = data.extraction;
  if (ext.festival_name) setName(ext.festival_name);
  if (ext.dates?.start) setStartDate(ext.dates.start);
  if (ext.dates?.end) setEndDate(ext.dates.end);
  if (ext.location) setLocation(ext.location);
  if (ext.region) setRegion(ext.region);
  if (ext.website_url) setWebsiteUrl(ext.website_url);
  if (ext.artists?.length) setArtists(ext.artists);
  setLineupUrl(data.lineupUrl ?? "");
  setPosterPageUrl(data.posterPageUrl);
  setLineupPending(data.lineupPending ?? false);
  setLogoImageUrl(data.logoImageUrl ?? null);   // unchanged — used for edit path
  setImageCandidates(data.imageCandidates);
  setAlgorithmPosterSrc(data.algorithmPosterSrc);
  // Pre-select algorithm picks
  if (data.algorithmPosterSrc) setSelectedPosterSrcs([data.algorithmPosterSrc]);
  setSelectedLogoSrc(data.logoImageUrl ?? data.algorithmPosterSrc ?? null);
  setShowImagePicker(true);   // show picker before form
  // DO NOT setShowForm(true) here — picker's Continue button does that
}}
```

**Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: errors about missing `ImagePicker` component (next task) and updated hidden inputs (Task 5).

**Step 5: Commit**

```bash
git add src/app/admin/festivals/scrape-progress.tsx src/app/admin/festivals/new/new-festival-form.tsx
git commit -m "feat: update interfaces and form state for image picker"
```

---

## Task 4: Create `image-picker.tsx` component

**Files:**
- Create: `src/app/admin/festivals/image-picker.tsx`

**Context:** This is the main new UI component. It renders two sections: lineup poster (multi-select checkboxes) and logo (single-select radio). Each image card has the image, a source label, a selection control, and a "Scrape" button (lineup only). Scraping calls `POST /api/admin/extract-poster` and merges artists via a callback.

**Step 1: Create the file with interfaces**

```typescript
"use client";

import { useState, useCallback } from "react";

export interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
}

interface ScrapeState {
  loading: boolean;
  done: boolean;
  artistCount: number;
  error: string | null;
}

interface ImagePickerProps {
  candidates: ImageCandidate[];
  algorithmPosterSrc: string | null;
  algorithmLogoSrc: string | null;
  selectedPosterSrcs: string[];
  selectedLogoSrc: string | null;
  onPosterChange: (srcs: string[]) => void;
  onLogoChange: (src: string | null) => void;
  onArtistsMerge: (artists: Array<{ name: string; billing: "headliner" | "support" }>) => void;
  onContinue: () => void;
}
```

**Step 2: Add the `ImageCard` sub-component**

```typescript
function ImageCard({
  candidate,
  selectionControl,
  isAlgoPick,
  onScrape,
  scrapeState,
}: {
  candidate: ImageCandidate;
  selectionControl: React.ReactNode;
  isAlgoPick: boolean;
  onScrape?: () => void;
  scrapeState?: ScrapeState;
}) {
  const sourceLabel = (() => {
    try { return new URL(candidate.sourcePage).pathname || "/"; } catch { return candidate.sourcePage; }
  })();

  return (
    <div
      className={`relative border-2 rounded-lg overflow-hidden flex flex-col ${
        isAlgoPick ? "border-blue-500" : "border-gray-200"
      }`}
    >
      {isAlgoPick && (
        <span className="absolute top-1 left-1 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded z-10">
          AI pick
        </span>
      )}
      <div className="absolute top-1 right-1 z-10">{selectionControl}</div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={candidate.src}
        alt={candidate.alt || "candidate"}
        className="w-full h-32 object-cover bg-gray-100"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />

      <div className="p-2 text-xs text-gray-500 flex flex-col gap-1 flex-1">
        <span className="truncate" title={candidate.sourcePage}>{sourceLabel}</span>
        {candidate.width && candidate.height && (
          <span>{candidate.width}×{candidate.height}</span>
        )}
        <span className="capitalize text-gray-400">{candidate.sourceClassification.replace("_", " ")}</span>
      </div>

      {onScrape && (
        <div className="px-2 pb-2">
          {scrapeState?.done ? (
            <span className="text-xs text-green-700 font-medium">
              ✓ Scraped ({scrapeState.artistCount} artists)
            </span>
          ) : scrapeState?.error ? (
            <span className="text-xs text-red-600">{scrapeState.error}</span>
          ) : (
            <button
              type="button"
              onClick={onScrape}
              disabled={scrapeState?.loading}
              className="w-full text-xs bg-gray-800 text-white rounded px-2 py-1 hover:bg-black disabled:opacity-50"
            >
              {scrapeState?.loading ? "Scraping..." : "Scrape"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Add the main `ImagePicker` component**

```typescript
export function ImagePicker({
  candidates,
  algorithmPosterSrc,
  algorithmLogoSrc,
  selectedPosterSrcs,
  selectedLogoSrc,
  onPosterChange,
  onLogoChange,
  onArtistsMerge,
  onContinue,
}: ImagePickerProps) {
  const [scrapeStates, setScrapeStates] = useState<Map<string, ScrapeState>>(new Map());

  // Exclude favicons from lineup section
  const lineupCandidates = candidates.filter(
    (c) => c.sourceClassification !== "favicon"
  );
  // Logo section: all candidates including favicon
  const logoCandidates = candidates;

  const handleScrape = useCallback(
    async (src: string) => {
      setScrapeStates((prev) =>
        new Map(prev).set(src, { loading: true, done: false, artistCount: 0, error: null })
      );
      try {
        const res = await fetch("/api/admin/extract-poster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ posterUrl: src }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Extraction failed");
        const artists = data.extraction?.artists ?? [];
        onArtistsMerge(artists);
        setScrapeStates((prev) =>
          new Map(prev).set(src, { loading: false, done: true, artistCount: artists.length, error: null })
        );
      } catch (err) {
        setScrapeStates((prev) =>
          new Map(prev).set(src, {
            loading: false,
            done: false,
            artistCount: 0,
            error: err instanceof Error ? err.message : "Failed",
          })
        );
      }
    },
    [onArtistsMerge]
  );

  function togglePoster(src: string) {
    if (selectedPosterSrcs.includes(src)) {
      onPosterChange(selectedPosterSrcs.filter((s) => s !== src));
    } else {
      onPosterChange([...selectedPosterSrcs, src]);
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Lineup Poster(s) */}
      <div>
        <h3 className="text-base font-semibold mb-1">Lineup Poster(s)</h3>
        <p className="text-sm text-gray-500 mb-3">
          Select one or more images to use as the festival lineup poster. Use &quot;Scrape&quot; to extract artists from a poster image.
        </p>
        {lineupCandidates.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No images found during crawl.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {lineupCandidates.map((c) => {
              const selected = selectedPosterSrcs.includes(c.src);
              return (
                <ImageCard
                  key={c.src}
                  candidate={c}
                  isAlgoPick={c.src === algorithmPosterSrc}
                  scrapeState={scrapeStates.get(c.src)}
                  onScrape={() => handleScrape(c.src)}
                  selectionControl={
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePoster(c.src)}
                      className="w-4 h-4 accent-blue-600"
                      aria-label="Select as lineup poster"
                    />
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Festival Logo */}
      <div>
        <h3 className="text-base font-semibold mb-1">Festival Logo</h3>
        <p className="text-sm text-gray-500 mb-3">
          Select one image to use as the festival logo.
        </p>
        {logoCandidates.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No images found during crawl.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {logoCandidates.map((c) => (
              <ImageCard
                key={c.src}
                candidate={c}
                isAlgoPick={c.src === algorithmLogoSrc}
                selectionControl={
                  <input
                    type="radio"
                    name="logo-pick"
                    checked={selectedLogoSrc === c.src}
                    onChange={() => onLogoChange(c.src)}
                    className="w-4 h-4 accent-blue-600"
                    aria-label="Select as logo"
                  />
                }
              />
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
      >
        Continue to Festival Details →
      </button>
    </div>
  );
}
```

**Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: clean or only errors about missing wiring in `new-festival-form.tsx`.

**Step 5: Commit**

```bash
git add src/app/admin/festivals/image-picker.tsx
git commit -m "feat: add ImagePicker component with lineup and logo selection"
```

---

## Task 5: Wire `ImagePicker` into `new-festival-form.tsx`

**Files:**
- Modify: `src/app/admin/festivals/new/new-festival-form.tsx`

**Step 1: Import `ImagePicker`**

Add at the top:

```typescript
import { ImagePicker, type ImageCandidate } from "../image-picker";
```

Remove the local `ImageCandidate` interface if you added it in Task 3 (it now comes from the import).

**Step 2: Add the image picker step to the JSX**

After the `ScrapeProgress` block and before the festival details form, add:

```tsx
{/* Step 1.5: Image picker — shown after scrape, before form */}
{showImagePicker && !showForm && (
  <div className="max-w-4xl bg-white p-6 rounded-lg shadow mb-6">
    <h2 className="text-lg font-bold mb-4">Step 1.5: Select Images</h2>
    <ImagePicker
      candidates={imageCandidates}
      algorithmPosterSrc={algorithmPosterSrc}
      algorithmLogoSrc={logoImageUrl}
      selectedPosterSrcs={selectedPosterSrcs}
      selectedLogoSrc={selectedLogoSrc}
      onPosterChange={setSelectedPosterSrcs}
      onLogoChange={setSelectedLogoSrc}
      onArtistsMerge={(newArtists) => {
        setArtists((prev) => {
          const existingNames = new Set(prev.map((a) => a.name.toLowerCase()));
          const toAdd = newArtists.filter(
            (a) => !existingNames.has(a.name.toLowerCase())
          );
          return [...prev, ...toAdd];
        });
      }}
      onContinue={() => {
        setShowForm(true);
        setShowImagePicker(false);
      }}
    />
  </div>
)}
```

**Step 3: Update the form's hidden inputs**

Remove the old poster/logo hidden inputs:
```tsx
// REMOVE:
{posterImageUrl && <input type="hidden" name="posterImageUrl" value={posterImageUrl} />}
{logoImageUrl && <input type="hidden" name="logoImageUrl" value={logoImageUrl} />}
```

Add new ones:
```tsx
{selectedPosterSrcs.length > 0 && (
  <input type="hidden" name="selectedPosterSrcs" value={JSON.stringify(selectedPosterSrcs)} />
)}
{selectedLogoSrc && (
  <input type="hidden" name="selectedLogoSrc" value={selectedLogoSrc} />
)}
```

**Step 4: Remove the old poster `<img>` preview**

Remove:
```tsx
{posterImageUrl && (
  <img src={posterImageUrl} alt="Festival poster" className="w-full max-w-sm rounded mb-4" />
)}
```

**Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: errors only in `createFestival` about old field names — fixed in Task 6.

**Step 6: Commit**

```bash
git add src/app/admin/festivals/new/new-festival-form.tsx
git commit -m "feat: wire ImagePicker into new festival creation form"
```

---

## Task 6: Update `createFestival` to upload selected images

**Files:**
- Modify: `src/lib/actions/festival.ts`

**Context:** `createFestival` currently reads `posterImageUrl` (a Supabase URL, no upload needed) and `logoImageUrl` (a Supabase URL, no upload needed) from the form. Now it receives external URLs that must be fetched and uploaded to Supabase. The action is a server action (`"use server"`) so it can use Node APIs and `supabaseAdmin`.

**Step 1: Add imports**

```typescript
import { supabaseAdmin } from "@/lib/supabase";
```

**Step 2: Add an upload helper inside the file (above `createFestival`)**

```typescript
async function uploadImageFromUrl(src: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(src, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = contentType.includes("png")
      ? ".png"
      : contentType.includes("webp")
      ? ".webp"
      : ".jpg";
    const filename = `crawled-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("posters")
      .upload(filename, buffer, { contentType, upsert: false });
    if (error) return null;
    return supabaseAdmin.storage.from("posters").getPublicUrl(filename).data.publicUrl;
  } catch {
    return null;
  }
}
```

**Step 3: Update `createFestival` to parse new fields**

Replace:
```typescript
const posterImageUrl = formData.get("posterImageUrl") as string;
const logoImageUrl = formData.get("logoImageUrl") as string | null;
```

With:
```typescript
const selectedPosterSrcsRaw = formData.get("selectedPosterSrcs") as string | null;
const selectedLogoSrc = formData.get("selectedLogoSrc") as string | null;
const selectedPosterSrcs: string[] = selectedPosterSrcsRaw
  ? JSON.parse(selectedPosterSrcsRaw)
  : [];
```

**Step 4: Replace poster/logo `FestivalPoster` creation**

Remove the old blocks:
```typescript
// REMOVE the old posterImageUrl block
// REMOVE the old logoImageUrl block
```

Add after the artists block:
```typescript
// Upload and create FestivalPoster records for selected lineup posters
for (const src of selectedPosterSrcs) {
  try {
    const uploadedUrl = await uploadImageFromUrl(src);
    if (!uploadedUrl) continue;
    await prisma.festivalPoster.create({
      data: {
        festivalId: festival.id,
        category: "full_lineup",
        imageUrl: uploadedUrl,
        version: 1,
      },
    });
  } catch (err) {
    console.error("[createFestival] Poster upload failed:", err);
  }
}

// Upload and create FestivalPoster record for selected logo
if (selectedLogoSrc) {
  try {
    // If it's already a Supabase URL (e.g. logo captured during crawl), use directly
    const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const logoUrl = selectedLogoSrc.startsWith(supabaseBase)
      ? selectedLogoSrc
      : await uploadImageFromUrl(selectedLogoSrc);
    if (logoUrl) {
      await prisma.festivalPoster.create({
        data: {
          festivalId: festival.id,
          category: "logo",
          imageUrl: logoUrl,
          version: 1,
        },
      });
    }
  } catch (err) {
    console.error("[createFestival] Logo upload failed:", err);
  }
}
```

**Step 5: TypeScript check — should be clean**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/lib/actions/festival.ts
git commit -m "feat: upload selected images on festival creation"
```

---

## Task 7: Manual verification

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Go to `/admin/festivals/new` and scrape a festival URL**

Use `https://boardmasters.com/` as a known test case.

**Verify after scrape:**
- Step 1.5 appears with "Lineup Poster(s)" and "Festival Logo" sections
- Multiple images appear in the grid
- The algorithm's AI pick has a blue border and "AI pick" badge
- Logo section shows favicon as pre-selected

**Step 3: Test scrape button**

Click "Scrape" on a poster image. Verify:
- Button shows "Scraping..." spinner
- On completion: "✓ Scraped (N artists)"
- Artist list in Step 2 gains additional artists (merged, no duplicates)

**Step 4: Test logo selection**

Click a different logo image. Verify the radio moves to it.

**Step 5: Click Continue and create festival**

Fill required fields, click "Create Festival". Verify:
- Festival is created
- `festival_posters` table has `full_lineup` records for each selected poster
- `festival_posters` table has `logo` record for selected logo
- Images are real Supabase URLs (not external URLs)

**Step 6: Verify edit-festival scrape still works**

Go to an existing festival's admin page, run the scraper. Verify:
- Scrape still completes
- Logo is still auto-saved to `festival_posters` (edit path unchanged)
- No errors in server console

---

## Summary of files changed

| File | Change |
|---|---|
| `src/lib/scraping/crawl-festival.ts` | Remove poster upload, add `imageCandidates`/`algorithmPosterSrc`, bump MIN_DIM to 800 |
| `src/app/api/admin/scrape-festival/route.ts` | Update SSE complete event |
| `src/app/admin/festivals/scrape-progress.tsx` | Update `CrawlCompleteData` interface |
| `src/app/admin/festivals/image-picker.tsx` | **New** — full image picker component |
| `src/app/admin/festivals/new/new-festival-form.tsx` | Wire in picker, update hidden inputs |
| `src/lib/actions/festival.ts` | Upload selected images, create `FestivalPoster` records |
