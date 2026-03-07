# Design: Lineup Pending Detection & Logo Extraction

**Date:** 2026-03-07

## Problem

When a festival hasn't released its lineup yet, the scraper wastes effort searching for
a poster and may pick up a generic branding image. Additionally, there is no festival
logo captured for use as a fallback image when no lineup poster exists.

## Solution Overview

1. Detect "coming soon" signals during text extraction and persist a `lineupPending` flag
2. Skip the poster candidate search when `lineupPending` is true
3. Always extract the festival logo (from favicon/apple-touch-icon) and store it as a
   `FestivalPoster` with a new `logo` category
4. Surface `lineupPending` in the admin festival view

---

## Section 1: Schema Changes

Two changes to `prisma/schema.prisma`:

```prisma
enum PosterCategory {
  full_lineup
  main_stage
  second_stage
  third_stage
  day_1
  day_2
  day_3
  day_4
  dance_electronic
  acoustic_unplugged
  other
  logo          // NEW
}

model Festival {
  // ... existing fields ...
  lineupPending  Boolean  @default(false) @map("lineup_pending")  // NEW
}
```

- `lineupPending` defaults to `false`
- Set to `true` when "coming soon" content is detected during scraping
- Cleared back to `false` on a subsequent scrape that finds a real lineup

---

## Section 2: "Coming Soon" Detection

`lineupPending` is added to the extraction tool schema in both the Gemini and Claude
`extract-festival.ts` providers:

```
lineup_pending: boolean
// "true if the lineup has not been announced yet — e.g. 'lineup coming soon',
//  'artists TBA', 'acts to be announced', 'lineup to follow'"
```

- `ExtractionResult` interface in `src/lib/extraction.ts` gains `lineupPending?: boolean`
- `TextExtractionResponse` is unchanged — `lineupPending` flows through inside `extraction`
- In `crawlFestival.ts`, after text extraction, `extraction.lineupPending` drives the
  poster search gate
- `CrawlResult` gains two new fields:
  ```ts
  lineupPending: boolean
  logoImageUrl: string | null
  ```

---

## Section 3: Logo Extraction

### Finding the logo

`scrapeUrl.ts` is extended to extract the favicon from the homepage HTML:

```ts
export interface ScrapeResult {
  // ... existing ...
  faviconUrl: string | null  // NEW
}
```

Priority order:
1. `<link rel="apple-touch-icon">` — typically 180×180px PNG, highest quality
2. `<link rel="icon" type="image/png">` — explicit PNG icon
3. `<link rel="shortcut icon">` — fallback

### Uploading the logo

In `crawlFestival.ts`, after the BFS loop, a logo step always runs unconditionally:
1. Fetch `homepage.faviconUrl`
2. Verify it's a valid image (`content-type: image/`) and at least 2KB
3. Upload to the existing `posters` Supabase bucket as `logo-{timestamp}.{ext}`
4. Return URL as `logoImageUrl` in `CrawlResult`

### Poster step gating

The existing poster candidate search (step 5 in `crawlFestival`) is wrapped:
```ts
if (!lineupPending) {
  // ... poster candidate search ...
}
```
The logo step runs regardless of `lineupPending`.

---

## Section 4: Data Flow

### Re-scraping an existing festival (`scrape-festival` API route)

When `festivalId` is provided, the festival update gains `lineupPending`:
```ts
await prisma.festival.update({
  data: { lineupUrl, posterPageUrl, lastScrapedAt, lineupPending }
});
```
A `FestivalPoster` record is created for the logo if `logoImageUrl` is present:
```ts
if (result.logoImageUrl) {
  await prisma.festivalPoster.create({
    data: { festivalId, category: "logo", imageUrl: result.logoImageUrl, version: 1 }
  });
}
```
The `complete` SSE event includes `lineupPending` and `logoImageUrl`.

### Creating a new festival (`new-festival-form.tsx` + `createFestival` action)

Two new hidden fields are added to the form:
- `lineupPending` (`"true"` / `"false"`)
- `logoImageUrl`

`createFestival` action:
- Saves `lineupPending` on the festival record
- Creates a `FestivalPoster` with `category: "logo"` if `logoImageUrl` is present

### Admin festival detail page

A yellow "Lineup Pending" badge is shown next to the festival name when
`festival.lineupPending` is true.

---

## Files Touched

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `logo` to `PosterCategory`, add `lineupPending` to `Festival` |
| `src/lib/extraction.ts` | Add `lineupPending?: boolean` to `ExtractionResult` |
| `src/lib/scraping/scrape-url.ts` | Add `faviconUrl` extraction to `ScrapeResult` |
| `src/lib/ai/providers/gemini/extract-festival.ts` | Add `lineup_pending` to schema |
| `src/lib/ai/providers/claude/extract-festival.ts` | Add `lineup_pending` to schema |
| `src/lib/scraping/crawl-festival.ts` | Gate poster search, add logo step, update `CrawlResult` |
| `src/app/api/admin/scrape-festival/route.ts` | Persist `lineupPending`, create logo `FestivalPoster` |
| `src/lib/actions/festival.ts` | Save `lineupPending` and logo `FestivalPoster` on create |
| `src/app/admin/festivals/new/new-festival-form.tsx` | Pass `lineupPending` and `logoImageUrl` as hidden fields |
| `src/app/admin/festivals/[id]/page.tsx` | Show "Lineup Pending" badge |
