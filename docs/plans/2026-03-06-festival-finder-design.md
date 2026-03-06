# Festival Finder - Design Document

**Date**: 2026-03-06
**Status**: Approved
**Goal**: Build a festival finder web app for real UK users, launching with artist-based search, filters, and AI-powered poster extraction.

---

## Overview

A web application where users can search for UK music festivals by artist name, with filters for date, location, price, and camping. Festival data is populated via AI-powered poster extraction (admin-controlled) and community submissions.

## Architecture

**Approach**: Monolithic Next.js application deployed on Vercel.

Everything lives in one codebase — public-facing pages, API routes, and admin panel. This is the simplest path to MVP with the least operational overhead.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | Next.js 15 (App Router) | Server components, API routes, SSR for SEO |
| Language | TypeScript | Type safety across the stack |
| Styling | Tailwind CSS | Fast UI development, utility-first |
| Database | Supabase (PostgreSQL) | Free tier, managed, built-in storage for images |
| ORM | Prisma | Type-safe queries, migrations |
| Image storage | Supabase Storage | Poster uploads |
| AI extraction | Anthropic Claude API (Vision) | Best multimodal understanding for artistic poster extraction |
| Search | PostgreSQL full-text search + ILIKE | Good enough for MVP |
| Hosting | Vercel | Native Next.js hosting, free tier |
| Admin auth | NextAuth.js (credentials provider) | Simple, works with App Router |

**Key decisions**:
- Server Components for public pages (SEO + performance)
- API Routes for admin actions and AI extraction
- Supabase client for direct DB reads in server components
- Prisma for write operations and migrations
- Image uploads go to Supabase Storage, URL stored in DB

## Data Model

### Festival
- `id`, `name`, `slug`, `description`
- `start_date`, `end_date`
- `location` (venue name, city, county/region)
- `latitude`, `longitude` (for distance-based search)
- `price_from`, `price_to` (GBP)
- `has_camping` (boolean)
- `website_url`, `ticket_url`
- `poster_image_url`
- `status` (draft | pending_review | published)
- `created_at`, `updated_at`

### Artist
- `id`, `name`, `slug`
- `spotify_id` (nullable, for future Spotify integration)
- `genre` (optional)

### FestivalArtist (many-to-many join)
- `festival_id`, `artist_id`
- `billing` (headliner | support | other)

### UserSubmission
- `id`, `festival_name`, `poster_image_url`
- `submitter_email` (optional)
- `location_hint` (free text)
- `status` (pending | approved | rejected)
- `created_at`

## User Experience

### Homepage
Search bar + featured/upcoming festivals. Users can immediately search by artist name or browse by filters.

### Search & Filters
- **Artist search**: Type artist names, see festivals ranked by number of matching artists
- **Filters**: Date range, UK region, price range, camping/non-camping
- **Results**: Card grid with festival name, dates, location, price range, top artists, poster thumbnail

### Festival Detail Page
- Full poster image
- Complete lineup (grouped by billing)
- Date, location, price info
- Camping info
- Direct link to festival website / ticket purchase
- Map showing location

### Festival Submission Page (public)
- Form: festival name, poster upload, location hint, optional email
- Duplicate check before submission (fuzzy match on name + dates)
- Success message explaining review process

## Admin Panel & AI Extraction

### Authentication
Simple email/password auth for admin-only routes. No public registration.

### Admin Dashboard (`/admin`)
- View pending user submissions
- Add new festivals (upload poster or fill in form)
- Manage existing festivals (edit, unpublish)

### AI Extraction Flow
1. Admin clicks "Extract from poster" on a festival/submission
2. Poster image sent to Claude Vision API with structured prompt
3. Claude returns JSON with festival name, dates, location, and all artist names with billing
4. Response shown to admin for review/correction
5. Admin approves, artists matched to existing DB records or created as new
6. Festival published

### Structured prompt returns:
```json
{
  "festival_name": "Glastonbury 2026",
  "dates": { "start": "2026-06-24", "end": "2026-06-28" },
  "location": "Pilton, Somerset",
  "artists": [
    { "name": "Arctic Monkeys", "billing": "headliner" },
    { "name": "Dua Lipa", "billing": "headliner" }
  ]
}
```

## Page Structure

```
Public routes:
  /                     Homepage (search bar, featured festivals)
  /festivals            Search results / browse all
  /festivals/[slug]     Festival detail page
  /submit               User festival submission form

Admin routes:
  /admin                Dashboard
  /admin/login          Admin login
  /admin/festivals      Manage all festivals
  /admin/festivals/new  Add new festival
  /admin/festivals/[id] Edit festival
  /admin/submissions    Review submissions queue
  /admin/submissions/[id] Review + trigger extraction
```

## MVP Scope

### In scope
- Festival search by artist name
- Filters: date, UK region, price range, camping
- Festival detail pages with full lineups
- Admin panel with AI poster extraction (Vision LLM)
- User festival submission with duplicate checking
- Links to festival websites for ticket purchase
- UK festivals only

### Out of scope (future)
- Spotify integration
- User accounts / saved festivals
- Email alerts
- Festival reviews/ratings
- Mobile app
- Non-UK festivals

## Submission & Moderation Flow

1. User submits festival (poster + basic info)
2. Auto-filter checks for duplicates (name + dates + location)
3. If passes, enters admin review queue
4. Admin approves -> triggers Vision LLM extraction -> admin verifies -> published
