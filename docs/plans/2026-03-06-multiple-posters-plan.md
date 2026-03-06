# Multiple Posters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support multiple versioned posters per festival, grouped by category, with merge-based artist extraction.

**Architecture:** New `FestivalPoster` model replaces the single `posterImageUrl` field on `Festival`. Posters are grouped by category (predefined + custom) and versioned. Only the latest version per category is displayed. Artist extraction merges into the existing lineup rather than replacing.

**Tech Stack:** Prisma 7 with `@prisma/adapter-pg`, Supabase PostgreSQL, Next.js 16 App Router, Server Actions

---

### Task 1: Add FestivalPoster model to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add PosterCategory enum and FestivalPoster model**

Add after the existing enums in `prisma/schema.prisma`:

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
```

Add after the `Festival` model:

```prisma
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

Add `posters FestivalPoster[]` to the `Festival` model's relation fields (next to `artists` and `usageLogs`).

**Step 2: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add FestivalPoster model to Prisma schema"
```

---

### Task 2: Create database table and migrate existing data

**Step 1: Create the PosterCategory enum and festival_posters table in Supabase**

Run via Supabase MCP `execute_sql`:

```sql
CREATE TYPE "PosterCategory" AS ENUM (
  'full_lineup', 'main_stage', 'second_stage', 'third_stage',
  'day_1', 'day_2', 'day_3', 'day_4',
  'dance_electronic', 'acoustic_unplugged', 'other'
);

CREATE TABLE festival_posters (
  id TEXT PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals(id) ON DELETE CASCADE,
  category "PosterCategory" NOT NULL,
  custom_category TEXT,
  image_url TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Step 2: Migrate existing poster data**

Run via Supabase MCP `execute_sql`:

```sql
INSERT INTO festival_posters (id, festival_id, category, image_url, version)
SELECT
  gen_random_uuid()::text,
  id,
  'full_lineup'::"PosterCategory",
  poster_image_url,
  1
FROM festivals
WHERE poster_image_url IS NOT NULL;
```

**Step 3: Drop posterImageUrl from festivals**

Run via Supabase MCP `execute_sql`:

```sql
ALTER TABLE festivals DROP COLUMN poster_image_url;
```

**Step 4: Remove posterImageUrl from Prisma schema**

In `prisma/schema.prisma`, remove this line from the `Festival` model:

```
  posterImageUrl String?        @map("poster_image_url")
```

**Step 5: Regenerate Prisma client**

Run: `npx prisma generate`

**Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: migrate poster data to festival_posters table"
```

---

### Task 3: Add poster category constants

**Files:**
- Modify: `src/lib/constants.ts`

**Step 1: Add POSTER_CATEGORIES constant**

Add to `src/lib/constants.ts`:

```typescript
export const POSTER_CATEGORIES = [
  { value: "full_lineup", label: "Full Lineup" },
  { value: "main_stage", label: "Main Stage" },
  { value: "second_stage", label: "Second Stage" },
  { value: "third_stage", label: "Third Stage" },
  { value: "day_1", label: "Day 1" },
  { value: "day_2", label: "Day 2" },
  { value: "day_3", label: "Day 3" },
  { value: "day_4", label: "Day 4" },
  { value: "dance_electronic", label: "Dance / Electronic" },
  { value: "acoustic_unplugged", label: "Acoustic / Unplugged" },
  { value: "other", label: "Other" },
] as const;
```

**Step 2: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat: add poster category constants"
```

---

### Task 4: Update upload-poster API to support categories and versioning

**Files:**
- Modify: `src/app/api/admin/upload-poster/route.ts`

**Step 1: Update the POST handler**

Replace the full file content with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PosterCategory } from "@/generated/prisma/client";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const festivalId = formData.get("festivalId") as string | null;
  const category = (formData.get("category") as string) || "full_lineup";
  const customCategory = formData.get("customCategory") as string | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const ext = file.name.split(".").pop();
  const prefix = festivalId || `temp-${Date.now()}`;
  const fileName = `${prefix}-${category}-${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("posters")
    .upload(fileName, file, { contentType: file.type });

  if (error) {
    logger.error("Poster upload failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: urlData } = supabaseAdmin.storage
    .from("posters")
    .getPublicUrl(fileName);

  let poster = null;
  if (festivalId) {
    // Find max version for this festival+category
    const existing = await prisma.festivalPoster.findMany({
      where: { festivalId, category: category as PosterCategory },
      orderBy: { version: "desc" },
      take: 1,
    });
    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

    poster = await prisma.festivalPoster.create({
      data: {
        festivalId,
        category: category as PosterCategory,
        customCategory: category === "other" ? customCategory : null,
        imageUrl: urlData.publicUrl,
        version: nextVersion,
      },
    });
  }

  return NextResponse.json({ url: urlData.publicUrl, poster });
}
```

**Step 2: Commit**

```bash
git add src/app/api/admin/upload-poster/route.ts
git commit -m "feat: upload-poster API supports categories and versioning"
```

---

### Task 5: Update extract-poster API to merge artists

**Files:**
- Modify: `src/app/api/admin/extract-poster/route.ts`

**Step 1: Update the PUT handler to merge instead of replace**

In the PUT handler, change the logic from deleting all existing `festivalArtist` records to only creating new ones. Replace the section starting at `// Delete existing artist associations` with:

```typescript
  // Merge: add new artists, skip duplicates
  const existingLinks = await prisma.festivalArtist.findMany({
    where: { festivalId },
    include: { artist: true },
  });
  const existingSlugs = new Set(existingLinks.map((l) => l.artist.slug));

  for (const a of artists as Array<{ name: string; billing: string }>) {
    const slug = slugify(a.name);
    if (existingSlugs.has(slug)) continue;

    let artist = await prisma.artist.findUnique({ where: { slug } });
    if (!artist) {
      artist = await prisma.artist.create({
        data: { name: a.name, slug },
      });
    }

    await prisma.festivalArtist.create({
      data: {
        festivalId,
        artistId: artist.id,
        billing: (a.billing as "headliner" | "support") || "support",
      },
    });
  }
```

**Step 2: Commit**

```bash
git add src/app/api/admin/extract-poster/route.ts
git commit -m "feat: extract-poster API merges artists instead of replacing"
```

---

### Task 6: Rewrite admin PosterSection for multi-poster support

**Files:**
- Modify: `src/app/admin/festivals/[id]/poster-section.tsx`

**Step 1: Rewrite the component**

Replace the full file with a new version that:
- Accepts `festivalId` and `posters` array (latest version per category) as props
- Shows an upload form with category dropdown (from `POSTER_CATEGORIES`) and a custom text field when "Other" is selected
- Displays a grid of existing poster cards, each with: image, category label, version badge, "Extract Artists" button
- Extract and apply flow works per-poster (same as before but scoped to one poster)
- Upload sends `category` and `customCategory` in the FormData

Props type:

```typescript
interface Poster {
  id: string;
  category: string;
  customCategory: string | null;
  imageUrl: string;
  version: number;
}

interface PosterSectionProps {
  festivalId: string;
  posters: Poster[];
}
```

**Step 2: Commit**

```bash
git add src/app/admin/festivals/[id]/poster-section.tsx
git commit -m "feat: admin poster section supports multiple categorised posters"
```

---

### Task 7: Update admin festival edit page to pass posters

**Files:**
- Modify: `src/app/admin/festivals/[id]/page.tsx`

**Step 1: Update the query to include posters**

Add `posters` to the `include` in the `findUnique` call. To get only the latest version per category, fetch all posters and filter in JS:

```typescript
const allPosters = festival.posters;
const latestPosters = Object.values(
  allPosters.reduce<Record<string, typeof allPosters[0]>>((acc, p) => {
    const key = p.category === "other" ? `other:${p.customCategory}` : p.category;
    if (!acc[key] || p.version > acc[key].version) {
      acc[key] = p;
    }
    return acc;
  }, {})
);
```

**Step 2: Update PosterSection usage**

Change from:

```tsx
<PosterSection festivalId={id} currentPosterUrl={festival.posterImageUrl} />
```

To:

```tsx
<PosterSection festivalId={id} posters={latestPosters} />
```

**Step 3: Commit**

```bash
git add src/app/admin/festivals/[id]/page.tsx
git commit -m "feat: admin festival edit page passes poster gallery data"
```

---

### Task 8: Update public festival page for poster gallery

**Files:**
- Modify: `src/app/festivals/[slug]/page.tsx`

**Step 1: Update the query to include posters**

Add `posters: true` to the `include` object in the `findUnique` call. Filter to latest version per category (same logic as Task 7).

**Step 2: Replace single poster display with gallery**

Replace the single `posterImageUrl` image/placeholder block with:

- If multiple posters: responsive grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`) with each poster showing the image and category label underneath
- If single poster: full-width image (current behaviour)
- If no posters: gradient placeholder (current behaviour)

**Step 3: Commit**

```bash
git add src/app/festivals/[slug]/page.tsx
git commit -m "feat: public festival page shows poster gallery"
```

---

### Task 9: Update festival card and listing queries

**Files:**
- Modify: `src/components/festival-card.tsx`
- Modify: `src/lib/queries.ts`

**Step 1: Update FestivalCard props**

Change `posterImageUrl: string | null` to `posters: Array<{ imageUrl: string }>`. Use `posters[0]?.imageUrl` for the card thumbnail (first/only poster).

**Step 2: Update queries to include posters**

In `searchFestivals` and `getFeaturedFestivals`, add `posters: true` to the `include`. Note: the `orderBy: { billing: "asc" }` on artists in these queries should also be removed (known pg adapter issue).

**Step 3: Update festival list pages that use FestivalCard**

Check `src/app/festivals/page.tsx` and homepage — update to pass `posters` instead of `posterImageUrl`.

**Step 4: Commit**

```bash
git add src/components/festival-card.tsx src/lib/queries.ts src/app/festivals/page.tsx src/app/page.tsx
git commit -m "feat: festival cards and queries use poster gallery"
```

---

### Task 10: Update new festival form

**Files:**
- Modify: `src/app/admin/festivals/new/new-festival-form.tsx`
- Modify: `src/lib/actions/festival.ts`

**Step 1: Update new festival form**

In `new-festival-form.tsx`, change the hidden `posterImageUrl` input to send `posterUrl` and add a `posterCategory` field (default "full_lineup"). The `createFestival` action will create a `FestivalPoster` record after creating the festival.

**Step 2: Update createFestival action**

In `src/lib/actions/festival.ts`, replace the `posterImageUrl` field in `festival.create` with a separate `FestivalPoster.create` call after the festival is created:

```typescript
const posterImageUrl = formData.get("posterImageUrl") as string;
// ... after festival creation:
if (posterImageUrl) {
  await prisma.festivalPoster.create({
    data: {
      festivalId: festival.id,
      category: "full_lineup",
      imageUrl: posterImageUrl,
      version: 1,
    },
  });
}
```

Remove `posterImageUrl` from the `festival.create` data object.

**Step 3: Commit**

```bash
git add src/app/admin/festivals/new/new-festival-form.tsx src/lib/actions/festival.ts
git commit -m "feat: new festival form creates poster record"
```

---

### Task 11: Update admin submissions page

**Files:**
- Modify: `src/app/admin/submissions/[id]/page.tsx`
- Modify: `src/app/admin/submissions/page.tsx`

**Step 1: Check for posterImageUrl references**

These files reference `posterImageUrl` from submissions — the `UserSubmission` model still has its own `posterImageUrl` field (that's fine, it's separate from festivals). Verify no references to `festival.posterImageUrl` exist in these files. If they do, update to use the posters relation.

**Step 2: Commit if changes needed**

```bash
git add src/app/admin/submissions/
git commit -m "fix: update submissions to work with poster gallery"
```

---

### Task 12: Build and verify

**Step 1: Run build**

Run: `npx next build`
Expected: Build succeeds with no type errors.

**Step 2: Manual verification**

- Admin: edit a festival, see existing posters in gallery
- Admin: upload a new poster with a different category
- Admin: upload an updated poster to same category (version increments)
- Admin: extract artists from a poster (merges, doesn't replace)
- Public: festival page shows poster gallery
- Festival cards show first poster as thumbnail

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address build issues from poster gallery migration"
```
