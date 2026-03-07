# Image Picker for Festival Creation — Design

Date: 2026-03-07

## Problem

The crawler auto-selects a single poster and logo image, but often picks the wrong one (e.g. a hero graphic instead of a lineup poster). Admins have no way to correct this without going back and manually editing after creation. Additionally, when the crawler's text extraction misses artists, there is no easy way to manually trigger poster extraction on a different image.

## Goals

- Show all images found during the crawl so the admin can pick the right poster(s) and logo.
- Algorithm pre-highlights its best guesses; admin can override.
- Allow per-image poster scraping (AI artist extraction) from the picker, merging results into the artist list.
- Remove wasted Supabase uploads — only upload images the admin actually selects.

## Decisions Made

- **Show all images** found during crawl (no pre-filtering by size in the grid).
- **800×800px + 50KB** quality threshold applies only to the algorithm's auto-selection (pre-highlighted image), not to what the admin can choose.
- **External URLs** used for display in the picker; images uploaded to Supabase only when the festival is saved.
- **Lineup picker**: multi-select (checkboxes) — supports multi-stage posters.
- **Logo picker**: single-select (radio), separate section — shows favicon + all page images. Algorithm pre-selects favicon.
- **Scrape per image**: only on lineup images; merges found artists into the existing artist list.
- **Edit-festival scrape section** is unchanged — image picker is new-festival only.

## Data Flow

### Crawl (`crawl-festival.ts`)

- Removes all Supabase upload logic (no more `crawled-*.png` or `logo-*.png` uploads during crawl).
- Collects all images found across all pages into a flat `imageCandidates` array.
- Favicon is added to candidates with `sourceClassification: "favicon"`.
- `algorithmPosterSrc`: first candidate in priority order (poster_only > lineup > fallback > og) that passes 800×800 + 50KB.
- `algorithmLogoSrc`: favicon URL if found, else null.
- `posterImageUrl` and `logoImageUrl` are removed from `CrawlResult`.

```typescript
interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
}

// Added to CrawlResult:
imageCandidates: ImageCandidate[];
algorithmPosterSrc: string | null;
algorithmLogoSrc: string | null;

// Removed from CrawlResult:
// posterImageUrl: string | null  → gone
// logoImageUrl: string | null    → gone
```

### SSE Complete Event (`scrape-festival/route.ts`)

Passes `imageCandidates`, `algorithmPosterSrc`, `algorithmLogoSrc` through to the client. Removes `posterImageUrl` and `logoImageUrl` from the event payload. `ScrapeLog` creation drops `posterImageUrl` reference.

### Image Picker UI (`image-picker.tsx` — new component)

Appears as "Step 1.5" between `ScrapeProgress` and the festival details form, after the scrape completes.

**Lineup Poster(s) section**
- Grid of all `imageCandidates` (excluding favicon).
- Multi-select checkboxes; `algorithmPosterSrc` pre-checked and badged "AI pick".
- Each card shows: image, source page path, dimensions if known.
- "Scrape" button per image — calls `POST /api/admin/extract-poster` with that `src`. Shows spinner while running. On success, merges artists into parent artist list state. Button becomes "✓ Scraped (N artists)" and is disabled for re-scraping the same image (tracked by src in a `Map`).

**Festival Logo section**
- Same grid but radio buttons; includes favicon candidate.
- `algorithmLogoSrc` pre-selected.
- No scrape button.

**Continue button** — advances to the festival details form, passing selected srcs up to parent state.

### Festival Save (`createFestival` server action)

Receives:
- `selectedPosterSrcs: string[]` — external URLs
- `selectedLogoSrc: string | null` — external URL

For each, fetches the image and uploads to Supabase `posters` bucket. Creates `FestivalPoster` records:
- Lineup images → `category: "full_lineup"`
- Logo → `category: "logo"`

Upload failures are silently skipped (logged server-side); festival creation proceeds regardless.

## Files to Change

| File | Change |
|---|---|
| `src/lib/scraping/crawl-festival.ts` | Remove upload logic; add `imageCandidates`, `algorithmPosterSrc`, `algorithmLogoSrc` to result; remove `posterImageUrl`/`logoImageUrl`; change MIN_DIM to 800 |
| `src/app/api/admin/scrape-festival/route.ts` | Update SSE complete event shape; drop poster/logo URL from ScrapeLog |
| `src/app/admin/festivals/scrape-progress.tsx` | Update `CrawlCompleteData` interface |
| `src/app/admin/festivals/image-picker.tsx` | **New component** — image picker UI |
| `src/app/admin/festivals/new/new-festival-form.tsx` | Wire in image picker step; pass selected srcs to form |
| `src/lib/actions/festival.ts` | Upload selected images in `createFestival`; create `FestivalPoster` records |

## Out of Scope

- Per-stage poster categorisation (main_stage, day_1 etc.) — use `full_lineup` for all for now.
- Image picker on the edit-festival page.
- Proxy route for hotlink-protected images.
