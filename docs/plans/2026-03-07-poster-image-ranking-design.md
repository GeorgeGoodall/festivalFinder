# Design: Source-Aware Poster Image Ranking

**Date:** 2026-03-07
**Status:** Approved

## Problem

The scraper always picks `posterImages[0]` as the festival poster. The first image is always the `og:image` meta tag, which is a site's social sharing image (usually a transparent logo or hero banner) — not the actual lineup poster.

## Goal

Pick the best candidate lineup poster image by using the page classification signal that the AI already produces during crawling.

## Design

### Priority Buckets

Replace the flat `posterImages: ImageCandidate[]` array in `crawl-festival.ts` with four priority buckets:

| Priority | Variable | Source |
|----------|----------|--------|
| 1 (best) | `posterPageImages` | `<img>` elements from pages classified `poster_only` |
| 2 | `lineupImages` | `<img>` elements from pages classified `lineup` |
| 3 | `homepageImages` | `<img>` elements (non-og) from the homepage |
| 4 (fallback) | `ogImage` | The `og:image` meta tag from any page |

Selection: take the first image from the highest-priority non-empty bucket.

### How to Distinguish og:image

`scrape-url.ts` already sets `alt: "og:image"` on the og:image candidate. Use this to separate it from real `<img>` elements when processing homepage images.

### Image Collection Points

- **Homepage**: split `homepage.images` — items with `alt === "og:image"` go to `ogImage` (last-write wins is fine), rest go to `homepageImages`
- **Crawled pages**: after `classifyPage`, push `page.images` (excluding og:image) to the appropriate bucket based on classification:
  - `poster_only` → `posterPageImages`
  - `lineup` → `lineupImages`
  - `info` / `irrelevant` → `homepageImages` (low-priority fallback)
- **og:image from crawled pages**: captured in `ogImage` bucket (overwritten each time — last seen is fine)

### Selection Logic

```ts
const bestImage =
  posterPageImages[0] ??
  lineupImages[0] ??
  homepageImages[0] ??
  ogImage ??
  null;
```

Both the poster upload and the `extractFromPoster` fallback use `bestImage`.

## Scope

- **Change**: `src/lib/scraping/crawl-festival.ts` only
- **No changes**: `scrape-url.ts`, `ImageCandidate` interface, AI pipeline files, anything else

## Expected Outcome

For a festival with a `/lineup/` page containing a large poster image, the scraper will pick that image instead of the `og:image` social banner.
