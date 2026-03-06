# Multiple Posters & Partial Lineup Support

## Problem

Festivals often release multiple posters (per stage, per day) and update them over time as lineups are confirmed. Currently the system supports a single `posterImageUrl` per festival, with extraction replacing all existing artists.

## Decisions

- **Merge, not replace**: Extracting artists from a new poster adds them to the existing lineup (skipping duplicates), never removes existing artists.
- **Versioned posters by category**: Each poster belongs to a category (e.g. Main Stage, Day 1). Uploading a new poster to the same category creates a new version. Only the latest version per category is displayed.
- **Predefined categories + custom**: Dropdown with common options, plus an "Other" option with a free-text label.
- **Simple merge**: No tracking of which artists came from which poster. Artists are just added to the festival lineup.

## Data Model

New `FestivalPoster` model, replacing `posterImageUrl` on `Festival`:

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
}

model FestivalPoster {
  id             String         @id @default(cuid())
  festivalId     String         @map("festival_id")
  category       PosterCategory
  customCategory String?        @map("custom_category")
  imageUrl       String         @map("image_url")
  version        Int            @default(1)
  createdAt      DateTime       @default(now()) @map("created_at")

  festival       Festival       @relation(fields: [festivalId], references: [id], onDelete: Cascade)

  @@map("festival_posters")
}
```

- `version` auto-increments per festival+category (computed at insert time)
- `customCategory` only used when `category = other`
- `Festival` gets `posters FestivalPoster[]` relation
- `posterImageUrl` removed from `Festival` after data migration

## Upload & Extraction Flow

1. Upload form includes a category dropdown (+ custom text for "Other")
2. Upload API creates a `FestivalPoster` record with `version = max(existing version for festival+category) + 1`
3. Old poster images stay in storage (version history preserved)
4. "Extract Artists" works per poster
5. "Apply Artists" merges — adds new artists, skips duplicates, never removes

## Admin UI

- Poster section shows all categories with their latest version
- Each poster card: image thumbnail, category label, version number, upload date
- Each poster has its own "Extract Artists" button
- Upload form at top with category picker

## Public Festival Page

- Gallery shows the latest version of each poster category
- Responsive grid: 1 col mobile, 2-3 on desktop
- Category label shown under each poster
- Single poster displays full-width (no grid)

## Migration

1. Create `festival_posters` table and `PosterCategory` enum
2. For each festival with a `posterImageUrl`, insert a `FestivalPoster` with `category = full_lineup`, `version = 1`
3. Drop `posterImageUrl` from `festivals`
