# Lineup Pending Detection & Logo Extraction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect when a festival hasn't released its lineup yet, skip the poster search in that case, and always capture the festival logo (favicon) as a `FestivalPoster` with `category: "logo"`.

**Architecture:** Add `lineup_pending` to the AI text extraction schema so the model returns it alongside artists/dates. Gate the poster candidate search on `!lineupPending`. Extract the favicon URL from the homepage HTML in `scrapeUrl` and upload it to Supabase storage as the logo, independent of whether `lineupPending` is set.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Supabase Storage, Gemini 2.5 Flash + Claude Haiku (AI providers), Cheerio (HTML parsing)

**No test suite exists** — verification is manual via the dev server.

---

### Task 1: Schema migration — add `logo` category and `lineupPending` field

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Edit the schema**

In `prisma/schema.prisma`, add `logo` to the `PosterCategory` enum and `lineupPending` to the `Festival` model:

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
  logo
}

model Festival {
  id             String         @id @default(cuid())
  name           String
  slug           String         @unique
  description    String?
  startDate      DateTime       @map("start_date")
  endDate        DateTime       @map("end_date")
  location       String
  region         String
  latitude       Float?
  longitude      Float?
  priceFrom      Int?           @map("price_from")
  priceTo        Int?           @map("price_to")
  hasCamping     Boolean        @default(false) @map("has_camping")
  websiteUrl     String?        @map("website_url")
  ticketUrl      String?        @map("ticket_url")
  lineupUrl      String?        @map("lineup_url")
  lineupHash     String?        @map("lineup_hash")
  posterPageUrl  String?        @map("poster_page_url")
  lastScrapedAt  DateTime?      @map("last_scraped_at")
  lineupPending  Boolean        @default(false) @map("lineup_pending")
  status         FestivalStatus @default(draft)
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")

  artists   FestivalArtist[]
  posters   FestivalPoster[]
  usageLogs ApiUsageLog[]

  @@map("festivals")
}
```

**Step 2: Run the migration**

```bash
npx prisma migrate dev --name add_lineup_pending_and_logo_category
```

Expected: migration created and applied, `src/generated/prisma` client regenerated automatically (via `postinstall` hook).

**Step 3: Verify**

```bash
npx prisma studio
```

Open the `festivals` table — confirm `lineup_pending` column exists with default `false`. Open the Prisma schema and confirm `logo` appears in the `PosterCategory` enum.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add lineup_pending to Festival and logo to PosterCategory"
```

---

### Task 2: Add `lineup_pending` to `ExtractionResult` interface

**Files:**
- Modify: `src/lib/extraction.ts`

**Step 1: Add the field**

In `src/lib/extraction.ts`, extend `ExtractionResult` with `lineup_pending`:

```ts
export interface ExtractionResult {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  artists: Array<{ name: string; billing: "headliner" | "support" }>;
  lineup_pending?: boolean;
}
```

No other changes needed in this file. The poster extraction function (`extractFromPoster`) doesn't need to return `lineup_pending` — that only comes from the text extraction path.

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/lib/extraction.ts
git commit -m "feat: add lineup_pending field to ExtractionResult interface"
```

---

### Task 3: Extract favicon URL in `scrapeUrl`

**Files:**
- Modify: `src/lib/scraping/scrape-url.ts`

**Step 1: Add `faviconUrl` to `ScrapeResult`**

In `src/lib/scraping/scrape-url.ts`, update `ScrapeResult`:

```ts
export interface ScrapeResult {
  url: string;
  text: string;
  jsonLd: string | null;
  links: LinkWithContext[];
  images: ImageCandidate[];
  title: string;
  faviconUrl: string | null;
}
```

**Step 2: Extract the favicon URL inside `scrapeUrl`**

After the JSON-LD extraction block (around line 176), before the `// --- Images ---` block, add:

```ts
// --- Favicon ---
let faviconUrl: string | null = null;
const appleIconHref = $('link[rel="apple-touch-icon"]').first().attr("href");
const pngIconHref = $('link[rel="icon"][type="image/png"]').first().attr("href");
const genericIconHref =
  $('link[rel="icon"]').first().attr("href") ||
  $('link[rel="shortcut icon"]').first().attr("href");
const faviconHref = appleIconHref || pngIconHref || genericIconHref;
if (faviconHref) {
  try {
    faviconUrl = new URL(faviconHref, url).toString();
  } catch {
    // ignore invalid href
  }
}
```

**Step 3: Include `faviconUrl` in the return value**

At the end of `scrapeUrl`, update the return:

```ts
return { url, text, jsonLd, links, images, title, faviconUrl };
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/lib/scraping/scrape-url.ts
git commit -m "feat: extract favicon URL in scrapeUrl"
```

---

### Task 4: Add `lineup_pending` to the Gemini extraction provider

**Files:**
- Modify: `src/lib/ai/providers/gemini/extract-festival.ts`

**Step 1: Add `lineup_pending` to the function declaration schema**

In the `functionDeclarations` array, inside the `parameters.properties` object, add after `artists`:

```ts
lineup_pending: {
  type: SchemaType.BOOLEAN,
  description:
    "true if the festival lineup has not been announced yet — e.g. 'lineup coming soon', 'artists TBA', 'acts to be announced', 'lineup to follow', 'coming soon'. false if artists are listed.",
},
```

Also add `"lineup_pending"` to the `required` array:

```ts
required: [
  "festival_name",
  "dates",
  "location",
  "region",
  "website_url",
  "artists",
  "lineup_pending",
],
```

**Step 2: Update the prompt to mention it**

In the `generateContent` call, add a rule to the prompt after the existing rules:

```
- Set lineup_pending to true if the site says the lineup is not yet announced (e.g. "coming soon", "TBA", "to be announced"). Set it to false if artists are listed.
```

The full updated prompt string becomes:

```ts
const result = await model.generateContent(
  `Analyze the following festival website content and extract all festival information.

The festival website is: ${websiteUrl}

Rules:
- Extract the festival name, dates, location, region, and website URL
- List ALL artists/bands found across the pages
- "headliner" = most prominent/top-billed artists, "support" = all other artists
- Do NOT include stage names, venue areas, sponsors, or generic text as artists
- If an artist name includes a featuring/collaboration (e.g. "Artist A feat. Artist B", "Artist A ft. Artist B", "Artist A x Artist B", "Artist A & Artist B", "Artist A b2b Artist B"), split them into SEPARATE artist entries with the same billing level
- If dates are unclear, use your best estimate. If year is missing, assume 2026
- If any field is unclear, use an empty string
- Set lineup_pending to true if the site says the lineup has not yet been announced (e.g. "coming soon", "TBA", "to be announced", "lineup coming soon"). Set to false if artists are listed.

Website content:

${assembled}`
);
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/lib/ai/providers/gemini/extract-festival.ts
git commit -m "feat: add lineup_pending detection to Gemini extraction provider"
```

---

### Task 5: Add `lineup_pending` to the Claude extraction provider

**Files:**
- Modify: `src/lib/ai/providers/claude/extract-festival.ts`

**Step 1: Add `lineup_pending` to the `extractionTool` input schema**

In the `input_schema.properties` object, after `artists`:

```ts
lineup_pending: {
  type: "boolean" as const,
  description:
    "true if the festival lineup has not been announced yet — e.g. 'lineup coming soon', 'artists TBA', 'acts to be announced', 'lineup to follow'. false if artists are listed.",
},
```

Add `"lineup_pending"` to the `required` array:

```ts
required: [
  "festival_name",
  "dates",
  "location",
  "region",
  "website_url",
  "artists",
  "lineup_pending",
],
```

**Step 2: Update the prompt**

After the existing rules in the `content` string, add:

```
- Set lineup_pending to true if the site says the lineup has not yet been announced (e.g. "coming soon", "TBA", "to be announced", "lineup coming soon"). Set to false if artists are listed.
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/lib/ai/providers/claude/extract-festival.ts
git commit -m "feat: add lineup_pending detection to Claude extraction provider"
```

---

### Task 6: Update `crawlFestival` — gate poster search, add logo step

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

This is the largest task. Work through it in sub-steps.

**Step 1: Update `CrawlResult` to include new fields**

```ts
export interface CrawlResult {
  extraction: ExtractionResult;
  source: "text" | "poster";
  lineupUrl: string | null;
  posterPageUrl: string | null;
  posterImageUrl: string | null;
  lineupPending: boolean;
  logoImageUrl: string | null;
  usage: UsageSummary;
  pageTree: PageNode;
  pagesScraped: number;
}
```

**Step 2: Add a helper to derive content-type extension**

Add this helper function near the other helpers (after `getExtensionFromUrl`):

```ts
function contentTypeToExt(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  return ".png";
}
```

**Step 3: Declare `lineupPending` and `logoImageUrl` variables**

After the other `let` declarations near the top of `crawlFestival` (around the `let discoveredLineupUrl` block), add:

```ts
let lineupPending = false;
let logoImageUrl: string | null = null;
```

**Step 4: Read `lineup_pending` from the extraction result**

After the extraction block (after `source = "text"` or `source = "poster"`), add:

```ts
lineupPending = extraction.lineup_pending ?? false;
```

The full extraction section becomes:

```ts
let extraction: ExtractionResult;
let source: "text" | "poster";

const bestCandidateForExtraction =
  posterPageImages[0] ?? lineupImages[0] ?? fallbackImages[0] ?? ogImage;

if (lineupContent.length > 0 || infoContent.length > 0) {
  emit({
    stage: "extracting",
    message: `Extracting festival details from ${lineupContent.length + infoContent.length} page(s)...`,
    usage: tracker.getSummary(),
  });

  const textResult = await extractFestivalFromText(
    lineupContent,
    infoContent,
    startUrl
  );
  tracker.addExtraction(textResult.usage);
  extraction = textResult.extraction;
  source = "text";
} else if (bestCandidateForExtraction) {
  emit({
    stage: "poster_fallback",
    message: "No HTML lineup found. Extracting from poster image...",
    usage: tracker.getSummary(),
  });

  const posterResult = await extractFromPoster(bestCandidateForExtraction.img.src);
  tracker.addExtraction(posterResult.usage);
  extraction = posterResult.extraction;
  source = "poster";
} else {
  throw new Error(
    "Could not find any lineup, festival info, or poster images"
  );
}

lineupPending = extraction.lineup_pending ?? false;

if (lineupPending) {
  emit({
    stage: "extracting",
    message: "Lineup not yet announced — skipping poster search.",
    usage: tracker.getSummary(),
  });
}
```

**Step 5: Gate the poster candidate search**

Wrap the entire "4b. Infer region" + "5. Poster storage" sections in `if (!lineupPending)`:

```ts
// -----------------------------------------------------------------------
// 4b. Infer region from location if needed
// -----------------------------------------------------------------------

if (
  extraction.location &&
  (!extraction.region ||
    !(UK_REGIONS as readonly string[]).includes(extraction.region))
) {
  // ... (unchanged region inference block)
}

// -----------------------------------------------------------------------
// 5. Poster storage — only if lineup has been announced
// -----------------------------------------------------------------------

let posterImageUrl: string | null = null;

if (!lineupPending) {
  const MIN_BYTES = 50 * 1024;
  const MIN_DIM = 400;

  const allCandidates: PosterCandidate[] = [
    ...posterPageImages,
    ...lineupImages,
    ...fallbackImages,
    ...(ogImage ? [ogImage] : []),
  ];

  // ... (rest of the existing poster search code, unchanged) ...
}
```

Note: `posterImageUrl` must be declared BEFORE the `if (!lineupPending)` block (as `let posterImageUrl: string | null = null;`) so it remains in scope for the return statement.

**Step 6: Add logo extraction step (after poster search, before return)**

```ts
// -----------------------------------------------------------------------
// 6. Logo extraction — always attempt, regardless of lineupPending
// -----------------------------------------------------------------------

if (homepage.faviconUrl) {
  emit({
    stage: "poster_search",
    message: "Fetching festival logo...",
    usage: tracker.getSummary(),
  });

  try {
    const logoController = new AbortController();
    const logoTimeout = setTimeout(() => logoController.abort(), 10_000);
    let logoResponse: Response;
    try {
      logoResponse = await fetch(homepage.faviconUrl, {
        signal: logoController.signal,
      });
    } finally {
      clearTimeout(logoTimeout);
    }

    const logoContentType = logoResponse.headers.get("content-type") || "";
    if (logoResponse.ok && logoContentType.startsWith("image/")) {
      const logoBuffer = Buffer.from(await logoResponse.arrayBuffer());
      const MIN_LOGO_BYTES = 2 * 1024; // 2KB — skip 1×1 tracking pixels
      if (logoBuffer.length >= MIN_LOGO_BYTES) {
        const logoExt = contentTypeToExt(logoContentType);
        const logoFilename = `logo-${Date.now()}${logoExt}`;

        const { error: logoError } = await supabaseAdmin.storage
          .from("posters")
          .upload(logoFilename, logoBuffer, {
            contentType: logoContentType,
            upsert: false,
          });

        if (!logoError) {
          const {
            data: { publicUrl },
          } = supabaseAdmin.storage.from("posters").getPublicUrl(logoFilename);
          logoImageUrl = publicUrl;
          emit({
            stage: "poster_search",
            message: `Logo captured (${Math.round(logoBuffer.length / 1024)}KB)`,
            usage: tracker.getSummary(),
          });
        } else {
          console.error("[logo] Supabase upload failed:", logoError);
        }
      } else {
        console.log(
          `[logo] Skipping logo: too small (${logoBuffer.length}B < 2KB)`
        );
      }
    } else {
      console.log(
        `[logo] Skipping logo: bad response or non-image content-type "${logoContentType}"`
      );
    }
  } catch (err) {
    console.warn("[logo] Failed to fetch logo:", err);
  }
}
```

**Step 7: Update the return statement**

```ts
return {
  extraction,
  source,
  lineupUrl: discoveredLineupUrl,
  posterPageUrl: discoveredPosterPageUrl,
  posterImageUrl,
  lineupPending,
  logoImageUrl,
  usage,
  pageTree: rootNode,
  pagesScraped: totalScraped,
};
```

**Step 8: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 9: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: gate poster search on lineupPending, add logo extraction step"
```

---

### Task 7: Update the scrape-festival API route

**Files:**
- Modify: `src/app/api/admin/scrape-festival/route.ts`

**Step 1: Persist `lineupPending` and create logo poster when `festivalId` is provided**

In the `try` block, replace the existing `if (body.festivalId)` section:

```ts
// If festivalId provided, update the festival record
if (body.festivalId) {
  await prisma.festival.update({
    where: { id: body.festivalId },
    data: {
      lineupUrl: result.lineupUrl,
      posterPageUrl: result.posterPageUrl,
      lastScrapedAt: new Date(),
      lineupPending: result.lineupPending,
    },
  });

  if (result.logoImageUrl) {
    await prisma.festivalPoster.create({
      data: {
        festivalId: body.festivalId,
        category: "logo",
        imageUrl: result.logoImageUrl,
        version: 1,
      },
    });
  }
}
```

**Step 2: Include the new fields in the `complete` SSE event**

```ts
sendEvent("complete", {
  extraction: result.extraction,
  source: result.source,
  lineupUrl: result.lineupUrl,
  posterPageUrl: result.posterPageUrl,
  posterImageUrl: result.posterImageUrl,
  lineupPending: result.lineupPending,
  logoImageUrl: result.logoImageUrl,
  usage: result.usage,
  pageTree: result.pageTree,
  pagesScraped: result.pagesScraped,
});
```

**Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/app/api/admin/scrape-festival/route.ts
git commit -m "feat: persist lineupPending and logo poster on re-scrape"
```

---

### Task 8: Update `createFestival` server action

**Files:**
- Modify: `src/lib/actions/festival.ts`

**Step 1: Read `lineupPending` and `logoImageUrl` from form data**

After the existing form data reads (after line 23), add:

```ts
const logoImageUrl = formData.get("logoImageUrl") as string | null;
const lineupPendingStr = formData.get("lineupPending") as string | null;
const lineupPending = lineupPendingStr === "true";
```

**Step 2: Save `lineupPending` when creating the festival**

In the `prisma.festival.create` data object, add:

```ts
lineupPending,
```

**Step 3: Create a `FestivalPoster` record for the logo**

After the existing `if (posterImageUrl)` block, add:

```ts
// Create FestivalPoster record for the logo if one was captured
if (logoImageUrl) {
  await prisma.festivalPoster.create({
    data: {
      festivalId: festival.id,
      category: "logo",
      imageUrl: logoImageUrl,
      version: 1,
    },
  });
}
```

**Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/lib/actions/festival.ts
git commit -m "feat: save lineupPending and logo poster on festival creation"
```

---

### Task 9: Update `new-festival-form.tsx` to pass new fields

**Files:**
- Modify: `src/app/admin/festivals/new/new-festival-form.tsx`

**Step 1: Update `CrawlCompleteData` type in `scrape-progress.tsx`**

The `ScrapeProgress` component's `CrawlCompleteData` interface lives in `src/app/admin/festivals/scrape-progress.tsx`. Add the new fields:

```ts
interface CrawlCompleteData {
  extraction: {
    festival_name: string;
    dates: { start: string; end: string };
    location: string;
    region: string;
    website_url: string;
    artists: Array<{ name: string; billing: "headliner" | "support" }>;
    lineup_pending?: boolean;
  };
  source: "text" | "poster";
  lineupUrl: string | null;
  posterPageUrl: string | null;
  posterImageUrl: string | null;
  lineupPending: boolean;
  logoImageUrl: string | null;
  usage: { ... };
  pageTree: PageNode;
  pagesScraped: number;
}
```

**Step 2: Add state variables in `new-festival-form.tsx`**

Add two new state variables alongside the existing ones:

```ts
const [lineupPending, setLineupPending] = useState(false);
const [logoImageUrl, setLogoImageUrl] = useState<string | null>(null);
```

**Step 3: Set them from the scrape result**

In the `onComplete` callback passed to `<ScrapeProgress>`:

```ts
onComplete={(data) => {
  setError(null);
  const ext = data.extraction;
  if (ext.festival_name) setName(ext.festival_name);
  if (ext.dates?.start) setStartDate(ext.dates.start);
  if (ext.dates?.end) setEndDate(ext.dates.end);
  if (ext.location) setLocation(ext.location);
  if (ext.region) setRegion(ext.region);
  if (ext.website_url) setWebsiteUrl(ext.website_url);
  if (ext.artists?.length) setArtists(ext.artists);
  setPosterImageUrl(data.posterImageUrl);
  setLineupUrl(data.lineupUrl ?? "");
  setPosterPageUrl(data.posterPageUrl);
  setLineupPending(data.lineupPending ?? false);
  setLogoImageUrl(data.logoImageUrl ?? null);
  setShowForm(true);
  setExtracted(true);
}}
```

**Step 4: Add hidden fields to the form**

In the form, alongside the other hidden inputs:

```tsx
<input type="hidden" name="lineupPending" value={String(lineupPending)} />
{logoImageUrl && (
  <input type="hidden" name="logoImageUrl" value={logoImageUrl} />
)}
```

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/app/admin/festivals/new/new-festival-form.tsx src/app/admin/festivals/scrape-progress.tsx
git commit -m "feat: pass lineupPending and logoImageUrl through new festival form"
```

---

### Task 10: Show "Lineup Pending" badge on the admin festival detail page

**Files:**
- Modify: `src/app/admin/festivals/[id]/page.tsx`

**Step 1: Add the badge next to the page heading**

Replace the heading section:

```tsx
<div className="flex justify-between items-center mb-6">
  <div className="flex items-center gap-3">
    <h1 className="text-2xl font-bold">Edit Festival</h1>
    {festival.lineupPending && (
      <span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2.5 py-1 rounded-full border border-yellow-300">
        Lineup Pending
      </span>
    )}
  </div>
  <form action={deleteAction}>
    <button
      type="submit"
      className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
    >
      Delete Festival
    </button>
  </form>
</div>
```

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (Prisma generated types include `lineupPending` after Task 1 migration).

**Step 3: Verify visually**

Start the dev server:

```bash
npm run dev
```

- Navigate to `/admin/festivals/[id]` for any festival
- If `lineupPending` is `true` in the DB, confirm the yellow badge appears
- Use Prisma Studio to manually toggle `lineup_pending` to `true` on a festival to test the badge without a full scrape

**Step 4: Commit**

```bash
git add src/app/admin/festivals/[id]/page.tsx
git commit -m "feat: show Lineup Pending badge on festival detail page"
```

---

### Task 11: End-to-end manual verification

**Step 1: Start the dev server**

```bash
npm run dev
```

**Step 2: Test logo extraction on a normal festival**

1. Navigate to `/admin/festivals/new`
2. Enter a festival URL that has a lineup and a favicon
3. Run the scrape
4. Confirm the scrape progress log shows "Logo captured"
5. After creation, navigate to the festival detail page — the `FestivalPoster` with category `logo` should appear in the Posters section

**Step 3: Test lineup pending detection**

1. Find (or create) a festival URL whose website says "coming soon" or "lineup TBA"
2. Scrape it
3. Confirm the log shows "Lineup not yet announced — skipping poster search."
4. Confirm `posterImageUrl` in the result is `null`
5. After creation, confirm the festival detail page shows the "Lineup Pending" badge
6. Confirm a logo poster was still captured (if the site had a favicon)

**Step 4: Test re-scraping an existing festival**

1. Go to an existing festival's detail page
2. Use the "Scrape from Website" section to re-scrape
3. Check the DB in Prisma Studio — confirm `lineup_pending` was updated

**Step 5: Final commit (if any loose ends)**

```bash
git add -p
git commit -m "chore: fix any loose ends from lineup pending implementation"
```
