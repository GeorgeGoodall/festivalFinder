# Festival Finder — Claude Code context

## Project overview

Next.js 16 (App Router) app for searching UK music festivals by artist. Admins scrape festival websites to extract lineup data using a combination of static HTML parsing, AI text extraction, and Claude Vision poster extraction.

## Tech stack

- **Next.js 16** with App Router and TypeScript
- **Tailwind CSS v4** — no `tailwind.config.ts`, config is CSS-based via `@import "tailwindcss"`
- **Prisma 7** with `@prisma/adapter-pg` (pg.Pool) — see Prisma notes below
- **Supabase** PostgreSQL (eu-central-1) + Storage (`posters` bucket)
- **NextAuth v4** — CredentialsProvider, JWT sessions, middleware protects `/admin/*`
- **AI** — Gemini Flash for text extraction (default), Claude Sonnet for poster vision; switchable via `AI_PROVIDER` env var
- **Playwright** — headless Chromium for JS-heavy sites
- **Cheerio** — static HTML parsing

## Critical: Prisma 7 setup

Prisma 7 changed how datasource and runtime config works:

- **No `url` field** in `datasource db` block in `schema.prisma` — Prisma 7 removed it
- **CLI config** lives in `prisma.config.ts` (loads `.env.local` via dotenv, uses `DIRECT_URL` for migrations)
- **Runtime** uses `@prisma/adapter-pg` with a `pg.Pool` in `src/lib/prisma.ts` — NOT `datasourceUrl`
- **Import path** is `@/generated/prisma/client` (not `@prisma/client`)
- `"postinstall": "prisma generate"` in `package.json`

## Critical: Supabase connection

- Pooler hostname: `aws-1-eu-central-1.pooler.supabase.com` (NOT `aws-0`)
- Session pooler: port 5432 (use for runtime `DATABASE_URL`)
- Direct DB: use for migrations (`DIRECT_URL`) — IPv6 only, no IPv4
- `pg.Pool` needs `ssl: { rejectUnauthorized: false }`
- Avoid special characters (`#`, `@`, `%`) in DB password — causes URL encoding issues with Supavisor

## File structure

```
src/lib/
  prisma.ts          PrismaClient singleton (pg adapter)
  auth.ts            NextAuth config
  supabase.ts        Supabase admin client (storage uploads)
  extraction.ts      Claude Vision poster extraction
  queries.ts         searchFestivals, getFeaturedFestivals
  constants.ts       UK_REGIONS array
  actions/
    festival.ts      Server actions for festival CRUD
    scrape.ts        Server actions wrapping crawl
  scraping/
    scrape-url.ts             Static cheerio scraper
    scrape-url-browser.ts     Playwright browser scraper
    crawl-festival.ts         BFS crawl orchestrator
    score-poster-candidates.ts Weighted poster scoring
    scrape-usage.ts           Token/cost tracking during crawl
  ai/
    filter-links.ts           Provider router → filters links for crawl
    classify-page.ts          Provider router → classifies page type
    extract-festival.ts       Provider router → extracts text data
    infer-region.ts           Provider router → infers UK region from location
    providers/claude/         Claude implementations (with prompt caching)
    providers/gemini/         Gemini implementations
```

## `export const dynamic = "force-dynamic"`

Required on every page that queries the database. Without it Next.js tries to prerender at build time and fails.

## AI provider pattern

Each AI capability (`filter-links`, `classify-page`, `extract-festival`, `infer-region`) has a thin router in `src/lib/ai/` that delegates to either `providers/claude/` or `providers/gemini/` based on the `AI_PROVIDER` env var (default: `gemini`). Claude provider files use prompt caching (`anthropic-beta: prompt-caching-2024-07-31`).

Poster extraction (`src/lib/extraction.ts`) always uses Claude Vision — it is not routed.

## Crawl pipeline

`crawlFestival()` in `src/lib/scraping/crawl-festival.ts` is the main entry point:

1. Fetch homepage (cheerio)
2. AI link filter → select relevant links
3. BFS crawl (max depth 3, max 10 pages, max 20 AI calls)
4. Classify each page (`lineup`, `poster_only`, `info`, `about`, `other`)
5. Extract text from lineup + info pages
6. Score poster image candidates (source page, URL keywords, year, alt text, aspect ratio, dimensions)
7. If ambiguous: Gemini multi-image disambiguation (top 5 candidates)
8. Claude Vision extraction on ranked candidates (up to 3 attempts)
9. Infer UK region if needed
10. Upload favicon as logo to Supabase Storage

Deep scrape (`scrapeUrlWithBrowser`) uses Playwright: pre-JS snapshot, scroll loop with "Show More" clicks, 4-gram novelty merge across all snapshots.

## Admin routes (all require NextAuth session)

| Route | Description |
|---|---|
| `POST /api/admin/scrape-festival` | SSE: crawl a single URL |
| `POST /api/admin/bulk-scrape` | SSE: crawl multiple URLs |
| `POST /api/admin/bulk-save-festival` | Save a bulk-scraped draft |
| `POST /api/admin/deep-scrape` | SSE: Playwright deep scrape |
| `POST /api/admin/extract-poster` | Extract artists from a poster image |
| `POST /api/admin/upload-poster` | Upload poster to Supabase Storage |

## Database schema highlights

- `festivals` — core record; `status` enum: `draft | pending_review | published`
- `festival_artists` — join table with `billing` (headliner/support), `day`, `stage`
- `festival_posters` — images per festival; `category` enum covers full_lineup, stage-specific, day-specific, logo, etc.
- `api_usage_logs` — every AI call is logged with model, tokens, festival context
- `scrape_logs` — scrape run history with page count, artist counts, error messages

## Dev commands

```bash
npm run dev           # Dev server (clears Turbopack cache first)
npm run build         # Production build
npm run db:migrate    # Prisma migrate dev
npm run db:push       # Prisma db push (no migration history)
npm run db:studio     # Prisma Studio
npm run db:generate   # prisma generate + clear Turbopack cache
```
