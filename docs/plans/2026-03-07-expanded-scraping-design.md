# Expanded Festival Scraping Design

**Date:** 2026-03-07
**Status:** Approved

## Overview

Expand the festival scraper to extract richer structured data from festival websites, reducing manual admin data entry and enabling better user-facing filtering.

## Goals

- Auto-populate more Festival fields from scraping (description, ticketUrl, hasCamping, campingDetails, ageRestriction, social links)
- Extract per-artist data: genre, day, stage
- Enable public filtering by camping, age restriction, and genre (derived from artists)

## Data Model Changes

### Festival (new fields)

| Field | Type | Notes |
|---|---|---|
| `socialInstagram` | `String?` | Full URL |
| `socialFacebook` | `String?` | Full URL |
| `socialX` | `String?` | Full URL |
| `socialTiktok` | `String?` | Full URL |
| `campingDetails` | `String?` | e.g. "glamping available, day tickets" |
| `ageRestriction` | `String?` | e.g. "18+", "family-friendly", "all ages" |

These existing fields will now be populated by the scraper (previously manual-only):
- `description`
- `ticketUrl`
- `hasCamping`

### FestivalArtist (new fields)

| Field | Type | Notes |
|---|---|---|
| `day` | `Int?` | 1, 2, 3... set only when explicitly stated in lineup |
| `stage` | `String?` | e.g. "Main Stage", "The Barn" |

### Artist (existing field — now populated)

- `genre String?` already exists in schema; the scraper will now extract and populate it from lineup page context.

## Page Targeting Changes

The link filter currently classifies pages as `lineup` or `info`. A new category is added:

- **`about`** — general festival info, description, social links, accessibility, age restrictions, camping details, ticket URL (e.g. `/about`, `/info`, `/faq`, `/accessibility`)

All four categories (`lineup`, `info`, `about`, plus deep-scrape for JS-heavy pages) are scraped and passed to the AI extraction step with their category label.

## AI Extraction Changes

The `extract_festival_info` tool schema gains the following fields:

| Field | Source pages | Notes |
|---|---|---|
| `description` | about/info | Short 2-3 sentence festival summary |
| `ticket_url` | any | Link to ticket purchase page |
| `social_links` | any | `{ instagram, facebook, x, tiktok }` — full URLs |
| `camping_details` | about/info | Free text, e.g. "glamping available" |
| `age_restriction` | about/info | e.g. "18+", "family-friendly", "all ages" |
| `has_camping` | about/info | Boolean |

Artist objects within the tool schema gain:

| Field | Notes |
|---|---|
| `genre` | Inferred from lineup context or stated genre (e.g. "DJ", "folk artist") |
| `day` | Only set if explicitly stated (e.g. "Friday headliner") |
| `stage` | Only set if explicitly stated (e.g. "Main Stage") |

### Prompt additions

- Extract a short (2-3 sentence) description of the festival from about/info content
- Pull social URLs as full URLs; skip if only a handle with no domain
- Only set `day`/`stage` on artists when explicitly listed in the lineup content — do not infer
- Genre should be a simple, lowercase tag (e.g. "rock", "electronic", "folk", "hip-hop", "jazz"); leave empty if unclear

## UI Changes

### Admin

- Festival detail page: show new fields (social links, camping details, age restriction) as editable inputs, pre-filled by scraper
- Artist list on festival page: show `day`, `stage`, `genre` columns where populated

### Public

- Festival cards: social media links as icon buttons
- Filter sidebar: camping toggle, age restriction selector
- Genre filtering: aggregate top genres from a festival's artists — display on festival card/page; no complex weighting in v1

## Out of Scope

- Ticket prices (deferred)
- Set times
- Transport / logistics info
- Third-party artist enrichment (Spotify/Last.fm) — separate feature
