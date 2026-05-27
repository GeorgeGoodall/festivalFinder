# Festival Finder

Search UK music festivals by artist. Find out which festivals your favourite acts are playing at, filtered by region, date, price, and camping.

## What it does

- **Artist search** — type one or more artist names to find every festival they're playing
- **Festival browse** — filter by UK region, date range, max ticket price, camping, and age restriction
- **AI-powered data ingestion** — paste a festival website URL and the system crawls it, extracts lineup and metadata, and stores it as a draft
- **Poster extraction** — during crawling, festival lineup posters are found, scored, and parsed by Claude Vision to supplement or replace text extraction
- **Deep scrape** — for JS-heavy sites (Wix, Squarespace, Webflow), a Playwright headless browser clicks through "Show More" buttons and merges scroll-position snapshots to capture full lineups
- **Community submissions** — visitors can submit festivals for admin review
- **Admin panel** — manage festivals, review submissions, track AI API usage and costs

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Database | Supabase PostgreSQL (eu-central-1) |
| Storage | Supabase Storage (poster images) |
| Auth | NextAuth v4 (credentials + JWT) |
| AI — text | Gemini Flash (default) or Claude Sonnet (configurable via `AI_PROVIDER`) |
| AI — posters | Claude Sonnet Vision + prompt caching |
| AI — disambiguation | Gemini Flash multi-image poster selection |
| Browser scraping | Playwright (Chromium headless) |
| HTML parsing | Cheerio |

## Getting started

### Prerequisites

- Node.js 20+
- A Supabase project (PostgreSQL + Storage bucket named `posters`)
- Anthropic API key
- Google AI API key

### Install

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env.local` and fill in the values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase session pooler connection string (port 5432) |
| `DIRECT_URL` | Supabase direct DB connection (used for migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `NEXTAUTH_SECRET` | Random secret for JWT signing |
| `NEXTAUTH_URL` | App base URL (e.g. `http://localhost:3000`) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_AI_API_KEY` | Google AI (Gemini) API key |
| `AI_PROVIDER` | Optional: `gemini` (default) or `claude` for text extraction |

### Database setup

```bash
# Run all migrations
npm run db:migrate

# Or push schema directly (no migration history)
npm run db:push

# Open Prisma Studio
npm run db:studio
```

### Seed an admin user

```bash
npx tsx prisma/seed.ts
```

### Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The admin panel is at `/admin` (requires login).

## How scraping works

Scraping a festival URL runs in several stages, streamed back to the browser via SSE:

1. **Fetch homepage** — static HTML fetch via cheerio, collects text, links, and images
2. **AI link filter** — Gemini/Claude selects relevant links (lineup, info, poster pages) from the homepage's link list
3. **BFS crawl** — visits selected pages up to depth 3 / 10 pages / 20 AI calls
4. **Page classification** — each page is classified as `lineup`, `poster_only`, `info`, `about`, or `other`
5. **Text extraction** — all lineup and info pages are sent to Gemini/Claude to extract festival name, dates, location, artists, and metadata
6. **Poster scoring** — images collected across all pages are scored by source type, URL keywords, year, alt text, aspect ratio, and dimensions
7. **Poster disambiguation** — if scores are ambiguous, the top 5 candidates are sent to Gemini Flash as base64 images to pick the best
8. **Poster extraction** — Claude Vision reads the winning poster image to supplement the artist list (up to 3 attempts on different candidates)
9. **Region inference** — if the region can't be matched to a UK region, a separate AI call infers it from the location string
10. **Logo capture** — the site's favicon/apple-touch-icon is uploaded to Supabase Storage

### Deep scrape

When static scraping detects a JS-rendered platform (Wix, Squarespace, Webflow) or a "Show More" button on a lineup page, a deep scrape can be triggered from the admin panel. This:

- Launches Playwright (headless Chromium)
- Captures a pre-JS HTML snapshot
- Scrolls the page incrementally (up to 20 passes, 600px steps)
- Clicks any "Show More"/"Load More" buttons it finds (up to 15 clicks)
- Takes a text snapshot after each scroll position
- Merges all snapshots using 4-gram novelty detection to capture content that appears and disappears as JS responds to scroll
- Sends the merged text to the AI for artist extraction

### Bulk add

Admins can paste a list of festival URLs (one per line). Each is crawled in parallel via SSE. Festivals with an unambiguous poster pick are auto-saved as drafts. Ambiguous ones appear inline for manual poster selection before saving.

## Project structure

```
src/
  app/
    page.tsx                    # Homepage with hero search
    festivals/                  # Public festival search and detail pages
    submit/                     # Community submission form
    admin/                      # Admin panel (auth protected)
      festivals/                # Festival management + scrape UI
        bulk-add/               # Bulk URL ingestion
      artists/                  # Artist management + split tool
      submissions/              # Review community submissions
      usage/                    # AI API usage and cost tracking
    api/
      admin/
        scrape-festival/        # SSE: crawl a single URL
        bulk-scrape/            # SSE: crawl multiple URLs
        bulk-save-festival/     # Save a bulk-scraped festival
        deep-scrape/            # SSE: Playwright deep scrape
        extract-poster/         # Extract artists from a poster image
        upload-poster/          # Upload a poster to Supabase Storage
      submissions/              # Public submission endpoint
      cron/scrape-lineups/      # Cron endpoint to refresh lineups
  lib/
    scraping/
      scrape-url.ts             # Static HTML scraper (cheerio)
      scrape-url-browser.ts     # Playwright browser scraper
      crawl-festival.ts         # Main BFS crawl orchestrator
      score-poster-candidates.ts # Weighted poster scoring algorithm
      scrape-usage.ts           # AI usage tracking during crawl
    ai/
      filter-links.ts           # Link filter (provider router)
      classify-page.ts          # Page classifier (provider router)
      extract-festival.ts       # Text extractor (provider router)
      infer-region.ts           # UK region inference (provider router)
      providers/
        claude/                 # Claude implementations
        gemini/                 # Gemini implementations
    extraction.ts               # Claude Vision poster extraction
    queries.ts                  # searchFestivals, getFeaturedFestivals
    actions/                    # Next.js server actions
    prisma.ts                   # PrismaClient singleton
    supabase.ts                 # Supabase admin client
    auth.ts                     # NextAuth config
    constants.ts                # UK_REGIONS list
prisma/
  schema.prisma                 # Database schema
  migrations/                  # Migration history
  seed.ts                       # Admin user seed
```

## Database schema

| Table | Purpose |
|---|---|
| `festivals` | Festival records with dates, location, region, price, social links |
| `artists` | Deduplicated artist records |
| `festival_artists` | Many-to-many join with billing (headliner/support), day, stage |
| `festival_posters` | Poster images per festival with category enum |
| `user_submissions` | Community-submitted festivals pending review |
| `admin_users` | Admin accounts (bcrypt passwords) |
| `api_usage_logs` | Per-call AI token and cost tracking |
| `scrape_logs` | Scrape run history with stats and error messages |

## Useful commands

```bash
npm run dev           # Start dev server (clears Turbopack cache first)
npm run build         # Production build
npm run db:migrate    # Run pending migrations
npm run db:studio     # Open Prisma Studio
npm run lint          # ESLint
```
