# Festival Website Crawler Design

## Overview

Replace the existing two-step festival data entry (poster upload + lineup URL scraping) with a single unified BFS web crawler. The admin pastes a festival homepage URL, the crawler explores the site to find lineup, dates, location, and poster images, then pre-fills the festival form.

## Decisions

- **Replaces** existing poster upload and lineup URL scraping entirely
- **Single entry point**: paste festival homepage URL, crawler does the rest
- **Manual fallback** preserved for festivals without a website
- **Model strategy**: Haiku for all navigation + text extraction, Sonnet for poster image fallback only
- **SSE streaming** with live progress log and page tree visualization
- **Cron re-check**: stores discovered lineup page URL for cheap re-checks; for poster-only festivals, stores the page URL where the poster was found and re-checks for new images
- **Poster storage**: download and store in Supabase Storage, plus keep original URL for cron re-checking

## Crawl Engine

### Architecture

BFS crawler adapted from projectBidWriter's `crawl-criteria.ts`, in `src/lib/scraping/crawl-festival.ts`.

### Constants

- `MAX_DEPTH = 3`
- `MAX_PAGES = 10`
- `MAX_AI_CALLS = 20`
- `MAX_CONTENT_LENGTH = 30000`

### Algorithm

1. Fetch homepage, extract links + content + image URLs
2. Push to BFS queue
3. For each batch of links from a page:
   - Filter to same domain only
   - Call Haiku `filterLinksForFestival` — which links likely lead to lineup, info, or poster pages?
   - For each selected link:
     - Fetch the page
     - Call Haiku `classifyPage` — returns category: `lineup`, `info`, `poster_only`, or `irrelevant`
     - Collect content into the appropriate bucket
     - Enqueue child links if depth < MAX
4. Stop when limits hit or no more links to explore

### Content Collection

Three separate buckets:

- `lineupContent: { url: string, text: string }[]` — pages with artist listings
- `infoContent: { url: string, text: string }[]` — pages with dates/location/details
- `posterImages: { pageUrl: string, imageUrl: string }[]` — candidate poster images

### Image Detection

Extract `<img>` tags with dimensions > 400px (or large image files). Also check `og:image` meta tags.

## AI Calls

### filterLinksForFestival (Haiku)

- **Input**: Array of links with URL, link text, ~200 chars surrounding context
- **Output**: Array of selected link URLs
- **Include**: lineup, artists, performers, acts, about, info, tickets, programme, schedule, stages, days
- **Exclude**: contact, privacy, terms, news, blog, press, careers, login, shop/merch, social media, accessibility, FAQs, cookies
- **When unsure**: include

### classifyPage (Haiku)

- **Input**: First 3000 chars of cleaned page text + JSON-LD
- **Output**: `{ category: "lineup" | "info" | "poster_only" | "irrelevant", confidence: number }`

### extractFestivalFromText (Haiku)

- **Input**: Assembled content from lineupContent + infoContent pages (capped at 30K chars), with source URLs as headers
- **Output**:
  ```typescript
  {
    festival_name: string;
    dates: { start: string; end: string };
    location: string;
    region: string;
    website_url: string;
    artists: Array<{ name: string; billing: "headliner" | "support" }>;
  }
  ```

### extractFromPoster (Sonnet) — Fallback

- **Trigger**: Only if lineupContent is empty AND posterImages is non-empty
- **Input**: Best candidate poster image
- **Output**: Same ExtractionResult shape
- **Reuses** existing `src/lib/extraction.ts`

## SSE Streaming & API

### Endpoint: `POST /api/admin/scrape-festival`

- **Input**: `{ url: string, festivalId?: string }`
- **Response**: Server-sent events stream

### SSE Event Types

| Event | Data | When |
|-------|------|------|
| `progress` | `{ stage, message, pageTree }` | Each crawl step |
| `complete` | `{ extraction, source, posterUrl?, lineupUrl?, usage }` | Crawl finished |
| `error` | `{ message }` | Fatal error |

### Progress Stages

- `"fetching"` — Fetching homepage...
- `"filtering"` — Analyzing N links...
- `"crawling"` — Fetching /path (page N of 10)...
- `"classifying"` — Classifying page: category detected
- `"extracting"` — Extracting festival details from N pages...
- `"poster_fallback"` — No HTML lineup found. Extracting from poster image...
- `"complete"` — done

### Page Tree Node

```typescript
interface PageNode {
  url: string;
  title: string;
  category: "lineup" | "info" | "poster_only" | "irrelevant" | "pending";
  children: PageNode[];
}
```

### Guards

- One active crawl at a time (429 if busy)
- AbortController wired to SSE stream
- Admin session required

## Cron Job

### Type 1: Has lineupUrl (HTML lineup found)

Same as current — fetch page, hash content, compare, re-extract if changed.

### Type 2: Has posterPageUrl but no lineupUrl (poster fallback)

- Fetch the page where the poster was found
- Extract image URLs from the page
- Compare against stored posterImageUrl
- If new/changed images: download, run through Sonnet vision, update artists

### New DB Field

```prisma
posterPageUrl  String?  @map("poster_page_url")
```

## UI Changes

### New Festival Form

Replace poster upload + lineup URL sections with unified flow:

1. Single URL input ("Festival Website URL") + "Scrape Festival" button
2. SSE progress log with page tree below
3. "Skip — enter details manually" link
4. Pre-filled form with all extracted data + poster preview
5. Admin reviews/edits and hits "Create Festival"

### Edit Festival Page

Replace "Scrape Lineup from Website" with:

- "Re-scrape from Website" button using stored websiteUrl
- Same SSE progress view
- Shows what changed, admin confirms before saving

### Shared Component

`scrape-progress.tsx` — SSE progress log + page tree, used by both forms.

## File Structure

### New Files

```
src/lib/scraping/crawl-festival.ts    — BFS crawler
src/lib/scraping/scrape-url.ts        — Page fetching, link/image extraction, HTML cleaning
src/lib/scraping/scrape-usage.ts      — Token/cost tracking

src/lib/ai/filter-links.ts            — Haiku: link filtering
src/lib/ai/classify-page.ts           — Haiku: page classification
src/lib/ai/extract-festival.ts        — Haiku: final structured extraction

src/app/api/admin/scrape-festival/route.ts  — SSE endpoint
src/app/admin/festivals/scrape-progress.tsx — Shared progress component
```

### Modified Files

```
src/app/admin/festivals/new/new-festival-form.tsx  — Unified scrape flow
src/app/admin/festivals/[id]/scrape-section.tsx    — Full re-scrape
src/app/admin/festivals/[id]/page.tsx              — Pass new fields
src/app/api/cron/scrape-lineups/route.ts           — Poster page re-check
prisma/schema.prisma                                — Add posterPageUrl
```

### Deleted/Replaced

```
src/app/api/admin/scrape-lineup/route.ts  — Replaced by scrape-festival
src/lib/scraping.ts                        — Split into scraping/* + ai/*
```

### Kept As-Is

```
src/lib/extraction.ts  — extractFromPoster (poster fallback)
```
