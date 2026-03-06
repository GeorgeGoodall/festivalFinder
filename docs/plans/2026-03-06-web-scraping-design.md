# Web Scraping Artist Extraction - Design

## Overview

Add the ability to extract festival artist lineups by scraping festival websites directly, as an alternative to the existing poster image extraction. This is cheaper (text tokens vs vision tokens), easier to keep updated, and works well for larger festivals that publish lineup pages.

## Decision: Both Paths Coexist

Poster extraction and web scraping live side by side. Admins choose per festival: paste a lineup URL, upload a poster, or both. Both feed into the same Artist / FestivalArtist tables.

## Decision: Single LLM Pass (No Heuristics)

Cleaned page text is sent to Claude Haiku via tool-use for extraction. No DOM heuristics or CSS selectors. Token cost is negligible for text and the simplicity outweighs any savings from pattern matching.

## Data Model Changes

Add to `Festival` model:
- `lineupUrl` (String?) - URL to the festival's lineup page
- `lineupHash` (String?) - SHA-256 hash of last scraped content for change detection
- `lastScrapedAt` (DateTime?) - when lineup was last successfully scraped

No new models. Artists use existing `Artist` / `FestivalArtist` tables.

## Scraping Flow

1. **Fetch** - plain `fetch()` to get page HTML
2. **Clean** - use `cheerio` to strip scripts, styles, nav, footer, ads; extract text content
3. **Validate + Extract** - single LLM call (Haiku) with tool-use: checks if it's a lineup page and extracts artists if so. Returns rejection reason if not a lineup page.
4. **Hash & Store** - SHA-256 hash cleaned text, save `lineupHash` and `lastScrapedAt`
5. **Upsert Artists** - merge into Artist / FestivalArtist using existing logic

### SPA Handling (Progressive)

If plain `fetch()` returns minimal content:
1. Check for JSON API endpoints in script tags
2. Check for JSON-LD / schema.org structured data
3. If neither works, tell admin "this site requires JavaScript rendering - not supported"

No headless browser (Playwright) needed. Can revisit later if many sites require it.

## Scheduled Re-checking

Vercel Cron Job (daily) via API route:

1. Query all festivals with a `lineupUrl`
2. Fetch and clean each page
3. Compare content hash against stored `lineupHash`
4. **Unchanged** - skip, update `lastScrapedAt` only
5. **Changed** - re-run LLM extraction, merge new artists, flag removals for admin review (don't auto-delete)

Rate limited: process sequentially with delay between requests.

## Admin UI

On festival create/edit page:
- **Lineup URL field** - text input for the URL
- **"Scrape Lineup" button** - triggers fetch, validate, extract flow
- Extracted artists shown in the same editable list as poster extraction
- Validation warning if LLM says it's not a lineup page, with "Extract anyway" option
- **Scrape status** - show `lastScrapedAt` and manual "Re-scrape" button on edit page

## Technical Details

- **LLM:** Claude Haiku via existing `@anthropic-ai/sdk`, logged to `ApiUsageLog`
- **HTML cleaning:** `cheerio` (lightweight, server-side)
- **Hashing:** Node built-in `crypto.createHash('sha256')`
- **Cron auth:** `CRON_SECRET` env var (Vercel sets automatically)

### New Files

- `src/lib/scraping.ts` - fetch, clean, hash, validate, extract functions
- `src/app/api/cron/scrape-lineups/route.ts` - cron endpoint
- `src/lib/actions/scrape.ts` - server action for admin-triggered scraping

### Modified Files

- `prisma/schema.prisma` - add 3 fields to Festival
- Festival create/edit pages - add lineup URL input + scrape button

## Artist Merge Strategy

- New artists found: auto-add
- Existing artists still present: no change
- Artists no longer on page: flag for admin review, don't auto-delete
