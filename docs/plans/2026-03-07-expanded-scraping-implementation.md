# Expanded Festival Scraping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scrape richer data per festival (social links, description, camping details, age restriction, ticket URL, artist genre/day/stage) and surface it in admin and public UI.

**Architecture:** Extend the extraction AI tool schema to return new fields. Add `about` as a fourth page category in the classifier so about/info pages are routed correctly. Pass the extracted fields through the SSE pipeline into the DB and UI.

**Tech Stack:** Prisma 7 (no `url` in datasource, uses `prisma.config.ts` for migrations), Next.js App Router server actions, Gemini 2.5 Flash + Claude Haiku as AI providers, Tailwind CSS v4.

---

## Key file map

| Layer | Files |
|---|---|
| Schema | `prisma/schema.prisma` |
| Shared types | `src/lib/extraction.ts` |
| Page classifier | `src/lib/ai/providers/gemini/classify-page.ts`, `src/lib/ai/providers/claude/classify-page.ts` |
| Text extraction | `src/lib/ai/providers/gemini/extract-festival.ts`, `src/lib/ai/providers/claude/extract-festival.ts` |
| Crawl orchestrator | `src/lib/scraping/crawl-festival.ts` |
| Scrape API route | `src/app/api/admin/scrape-festival/route.ts` |
| DB actions | `src/lib/actions/festival.ts`, `src/lib/actions/scrape.ts` |
| Admin UI | `src/app/admin/festivals/[id]/page.tsx`, `src/app/admin/festivals/new/new-festival-form.tsx`, `src/app/admin/festivals/scrape-progress.tsx`, `src/app/admin/festivals/[id]/scrape-section.tsx` |
| Public UI | `src/app/festivals/[slug]/page.tsx`, `src/components/festival-card.tsx`, `src/components/search-filters.tsx`, `src/lib/queries.ts` |

---

## Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev`

**Step 1: Add new fields to schema.prisma**

In the `Festival` model, after the `lineupPending` field, add:

```prisma
socialInstagram String? @map("social_instagram")
socialFacebook  String? @map("social_facebook")
socialX         String? @map("social_x")
socialTiktok    String? @map("social_tiktok")
campingDetails  String? @map("camping_details")
ageRestriction  String? @map("age_restriction")
```

In the `FestivalArtist` model, after the `billing` field, add:

```prisma
day   Int?
stage String?
```

**Step 2: Run migration**

```bash
npx prisma migrate dev --name add_expanded_scraping_fields
```

Expected: migration created and applied, `src/generated/prisma/` types regenerated.

**Step 3: Verify types**

Open `src/generated/prisma/index.d.ts` and confirm `Festival` type includes `socialInstagram`, `socialFacebook`, `socialX`, `socialTiktok`, `campingDetails`, `ageRestriction`, and `FestivalArtist` includes `day` and `stage`.

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add social links, camping details, age restriction, artist day/stage fields"
```

---

## Task 2: Extend ExtractionResult type

**Files:**
- Modify: `src/lib/extraction.ts`

**Step 1: Update the shared ExtractionResult interface**

Replace the existing `ExtractionResult` interface (lines 5-13) with:

```typescript
export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  x?: string;
  tiktok?: string;
}

export interface ExtractedArtist {
  name: string;
  billing: "headliner" | "support";
  genre?: string;
  day?: number;
  stage?: string;
}

export interface ExtractionResult {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  description?: string;
  ticket_url?: string;
  social_links?: SocialLinks;
  has_camping?: boolean;
  camping_details?: string;
  age_restriction?: string;
  artists: ExtractedArtist[];
  lineup_pending?: boolean;
}
```

**Step 2: Commit**

```bash
git add src/lib/extraction.ts
git commit -m "feat: extend ExtractionResult with social links, camping, age restriction, artist genre/day/stage"
```

---

## Task 3: Add `about` category to classify-page providers

**Files:**
- Modify: `src/lib/ai/providers/gemini/classify-page.ts`
- Modify: `src/lib/ai/providers/claude/classify-page.ts`

**Step 1: Update Gemini classify-page**

Change the `PageCategory` type and enum in the tool schema from:
```
"lineup" | "info" | "poster_only" | "irrelevant"
```
to:
```
"lineup" | "info" | "about" | "poster_only" | "irrelevant"
```

Update the enum description string to add:
```
"about = page contains festival description, social media links, camping info, accessibility, age restrictions, FAQs, or ticket purchase links but not a lineup. "
```

Also add `"about"` to the `enum` array in the Gemini `SchemaType.STRING` properties block.

**Step 2: Update Claude classify-page**

Same change — add `"about"` to the enum array and the description string.

**Step 3: Update the type export**

In `src/lib/ai/classify-page.ts` the type is re-exported from the Gemini provider — no change needed there since it re-exports `PageCategory`.

**Step 4: Commit**

```bash
git add src/lib/ai/providers/gemini/classify-page.ts src/lib/ai/providers/claude/classify-page.ts
git commit -m "feat: add 'about' page category to classifier"
```

---

## Task 4: Update crawl-festival.ts to handle `about` pages

**Files:**
- Modify: `src/lib/scraping/crawl-festival.ts`

**Step 1: Add aboutContent collector**

After the `infoContent` array declaration (line 149), add:

```typescript
const aboutContent: { url: string; text: string }[] = [];
```

**Step 2: Route about pages**

In the section that routes pages by classification (after line 339 where `classification.category === "info"` is handled), add an `else if` before the existing `info` branch:

```typescript
} else if (classification.category === "about") {
  aboutContent.push({ url: page.url, text: page.text });
} else if (classification.category === "info") {
```

**Step 3: Pass aboutContent to extractFestivalFromText**

Update the call to `extractFestivalFromText` (around line 393):

```typescript
const textResult = await extractFestivalFromText(
  lineupContent,
  infoContent,
  startUrl,
  aboutContent,
);
```

**Step 4: Commit**

```bash
git add src/lib/scraping/crawl-festival.ts
git commit -m "feat: collect 'about' pages separately and pass to extraction"
```

---

## Task 5: Update extract-festival Claude provider

**Files:**
- Modify: `src/lib/ai/providers/claude/extract-festival.ts`

**Step 1: Update function signature**

Change:
```typescript
export async function extractFestivalFromText(
  lineupContent: { url: string; text: string }[],
  infoContent: { url: string; text: string }[],
  websiteUrl: string
)
```
to:
```typescript
export async function extractFestivalFromText(
  lineupContent: { url: string; text: string }[],
  infoContent: { url: string; text: string }[],
  websiteUrl: string,
  aboutContent: { url: string; text: string }[] = []
)
```

**Step 2: Include aboutContent in assembled content**

After the loop that assembles `infoContent` parts (before lineup pages), add:
```typescript
for (const page of aboutContent) {
  parts.push(`--- Source (about): ${page.url} ---\n${page.text}`);
}
```

**Step 3: Add new fields to extractionTool schema**

Inside `input_schema.properties`, add after `website_url`:

```typescript
description: {
  type: "string",
  description: "Short 2-3 sentence description of the festival, or empty string",
},
ticket_url: {
  type: "string",
  description: "URL of the ticket purchase page, or empty string",
},
social_links: {
  type: "object",
  properties: {
    instagram: { type: "string", description: "Instagram profile URL, or empty string" },
    facebook: { type: "string", description: "Facebook page URL, or empty string" },
    x: { type: "string", description: "X (Twitter) profile URL, or empty string" },
    tiktok: { type: "string", description: "TikTok profile URL, or empty string" },
  },
},
has_camping: {
  type: "boolean" as const,
  description: "true if camping is available at the festival",
},
camping_details: {
  type: "string",
  description: "Extra camping info e.g. 'glamping available, day tickets only', or empty string",
},
age_restriction: {
  type: "string",
  description: "e.g. '18+', 'family-friendly', 'all ages', or empty string",
},
```

**Step 4: Update artists array schema to include genre, day, stage**

Inside the `artists.items.properties`, add after `billing`:

```typescript
genre: {
  type: "string",
  description: "Lowercase genre tag e.g. 'rock', 'electronic', 'folk', 'hip-hop'. Leave empty string if unclear.",
},
day: {
  type: "number",
  description: "Day number (1, 2, 3...) this artist performs. Only set if explicitly stated in the lineup.",
},
stage: {
  type: "string",
  description: "Stage name e.g. 'Main Stage', 'The Barn'. Only set if explicitly stated.",
},
```

**Step 5: Update the prompt rules**

Add to the rules string:
```
- Extract a short (2-3 sentence) description of the festival from about/info content — summarise what kind of festival it is, where and when
- Extract ticket_url if a dedicated ticket purchase page is linked
- Extract social_links: full URLs only (not handles), leave empty string if not found
- Set has_camping to true if the festival mentions camping is available
- Extract camping_details for extra detail beyond yes/no (e.g. "glamping available")
- Extract age_restriction if stated (e.g. "18+", "family-friendly")
- For each artist, set genre if clearly indicated (e.g. "jazz artist", "DJ", listed under a genre section). Use simple lowercase tags.
- Set artist day and stage ONLY when explicitly stated in lineup content. Do not infer.
```

**Step 6: Commit**

```bash
git add src/lib/ai/providers/claude/extract-festival.ts
git commit -m "feat: extend Claude extraction tool with social links, camping, age restriction, artist genre/day/stage"
```

---

## Task 6: Update extract-festival Gemini provider

**Files:**
- Modify: `src/lib/ai/providers/gemini/extract-festival.ts`

**Step 1: Update function signature** — same as Task 5 Step 1.

**Step 2: Include aboutContent** — same as Task 5 Step 2.

**Step 3: Add new fields to Gemini tool schema**

The Gemini provider uses `SchemaType` from `@google/generative-ai`. After `website_url`:

```typescript
description: {
  type: SchemaType.STRING,
  description: "Short 2-3 sentence description of the festival, or empty string",
},
ticket_url: {
  type: SchemaType.STRING,
  description: "URL of the ticket purchase page, or empty string",
},
social_links: {
  type: SchemaType.OBJECT,
  properties: {
    instagram: { type: SchemaType.STRING, description: "Instagram profile URL, or empty string" },
    facebook: { type: SchemaType.STRING, description: "Facebook page URL, or empty string" },
    x: { type: SchemaType.STRING, description: "X (Twitter) profile URL, or empty string" },
    tiktok: { type: SchemaType.STRING, description: "TikTok profile URL, or empty string" },
  },
},
has_camping: {
  type: SchemaType.BOOLEAN,
  description: "true if camping is available at the festival",
},
camping_details: {
  type: SchemaType.STRING,
  description: "Extra camping info, or empty string",
},
age_restriction: {
  type: SchemaType.STRING,
  description: "e.g. '18+', 'family-friendly', 'all ages', or empty string",
},
```

**Step 4: Update artists items schema**

After `billing` in the artists array items properties:

```typescript
genre: {
  type: SchemaType.STRING,
  description: "Lowercase genre tag e.g. 'rock', 'electronic'. Empty string if unclear.",
},
day: {
  type: SchemaType.NUMBER,
  description: "Day number (1, 2, 3...) if explicitly stated in lineup.",
},
stage: {
  type: SchemaType.STRING,
  description: "Stage name if explicitly stated.",
},
```

**Step 5: Update the prompt rules** — add the same rules as Task 5 Step 5.

**Step 6: Commit**

```bash
git add src/lib/ai/providers/gemini/extract-festival.ts
git commit -m "feat: extend Gemini extraction tool with social links, camping, age restriction, artist genre/day/stage"
```

---

## Task 7: Update scrape-festival route.ts

**Files:**
- Modify: `src/app/api/admin/scrape-festival/route.ts`

**Step 1: Update the festival.update call to include new fields**

When `body.festivalId` is present, the existing `prisma.festival.update` call (around line 113) only saves `lineupUrl`, `posterPageUrl`, `lastScrapedAt`, `lineupPending`. Extend it:

```typescript
await prisma.festival.update({
  where: { id: body.festivalId },
  data: {
    lineupUrl: result.lineupUrl,
    posterPageUrl: result.posterPageUrl,
    lastScrapedAt: new Date(),
    lineupPending: result.lineupPending,
    // New fields from extraction
    description: result.extraction.description || undefined,
    ticketUrl: result.extraction.ticket_url || undefined,
    hasCamping: result.extraction.has_camping ?? undefined,
    campingDetails: result.extraction.camping_details || undefined,
    ageRestriction: result.extraction.age_restriction || undefined,
    socialInstagram: result.extraction.social_links?.instagram || undefined,
    socialFacebook: result.extraction.social_links?.facebook || undefined,
    socialX: result.extraction.social_links?.x || undefined,
    socialTiktok: result.extraction.social_links?.tiktok || undefined,
  },
});
```

Use `|| undefined` so empty strings don't overwrite existing data with blanks. Use `?? undefined` for booleans (only update if AI returned a value).

**Step 2: Commit**

```bash
git add src/app/api/admin/scrape-festival/route.ts
git commit -m "feat: apply scraped social links, camping, age restriction to festival on re-scrape"
```

---

## Task 8: Update scrape-progress.tsx types

**Files:**
- Modify: `src/app/admin/festivals/scrape-progress.tsx`

**Step 1: Extend the extraction type in CrawlCompleteData**

In the `CrawlCompleteData` interface (around line 29), the `extraction` field currently has:
```typescript
extraction: {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  artists: Array<{ name: string; billing: "headliner" | "support" }>;
  lineup_pending?: boolean;
};
```

Replace with:
```typescript
extraction: {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  description?: string;
  ticket_url?: string;
  social_links?: { instagram?: string; facebook?: string; x?: string; tiktok?: string };
  has_camping?: boolean;
  camping_details?: string;
  age_restriction?: string;
  artists: Array<{ name: string; billing: "headliner" | "support"; genre?: string; day?: number; stage?: string }>;
  lineup_pending?: boolean;
};
```

**Step 2: Add `about` to CATEGORY_STYLES and PageNode type**

In the `PageNode` interface, update the `category` union:
```typescript
category?: "lineup" | "info" | "about" | "poster_only" | "irrelevant";
```

In `CATEGORY_STYLES`:
```typescript
about: { label: "[A]", className: "text-orange-500" },
```

Also add to the legend in the JSX:
```tsx
<span>
  <span className="font-bold text-orange-500">[A]</span> about
</span>
```

**Step 3: Commit**

```bash
git add src/app/admin/festivals/scrape-progress.tsx
git commit -m "feat: update scrape-progress types for new extraction fields and about category"
```

---

## Task 9: Update saveScrapedArtists action

**Files:**
- Modify: `src/lib/actions/scrape.ts`

**Step 1: Update the Artist parameter type**

Change the `artists` parameter from:
```typescript
artists: Array<{ name: string; billing: "headliner" | "support" }>
```
to:
```typescript
artists: Array<{ name: string; billing: "headliner" | "support"; genre?: string; day?: number; stage?: string }>
```

**Step 2: Save genre when creating/updating artist**

When creating a new artist, include `genre`:
```typescript
artist = await prisma.artist.create({
  data: { name: a.name, slug, genre: a.genre || null },
});
```

When the artist already exists and `a.genre` is provided, update it:
```typescript
if (a.genre && !artist.genre) {
  await prisma.artist.update({
    where: { slug },
    data: { genre: a.genre },
  });
}
```

**Step 3: Save day and stage on FestivalArtist**

Update the `festivalArtist.create` call:
```typescript
await prisma.festivalArtist.create({
  data: {
    festivalId,
    artistId: artist.id,
    billing: a.billing || "support",
    day: a.day ?? null,
    stage: a.stage || null,
  },
});
```

**Step 4: Commit**

```bash
git add src/lib/actions/scrape.ts
git commit -m "feat: save artist genre, day, stage when persisting scraped artists"
```

---

## Task 10: Update new-festival-form.tsx

**Files:**
- Modify: `src/app/admin/festivals/new/new-festival-form.tsx`

**Step 1: Add state for new fields**

Add to the state declarations:
```typescript
const [description, setDescription] = useState("");
const [ticketUrl, setTicketUrl] = useState("");
const [hasCamping, setHasCamping] = useState(false);
const [campingDetails, setCampingDetails] = useState("");
const [ageRestriction, setAgeRestriction] = useState("");
const [socialInstagram, setSocialInstagram] = useState("");
const [socialFacebook, setSocialFacebook] = useState("");
const [socialX, setSocialX] = useState("");
const [socialTiktok, setSocialTiktok] = useState("");
```

**Step 2: Pre-fill from extraction in onComplete callback**

In the `ScrapeProgress onComplete` handler, add:
```typescript
if (ext.description) setDescription(ext.description);
if (ext.ticket_url) setTicketUrl(ext.ticket_url);
if (ext.has_camping != null) setHasCamping(ext.has_camping);
if (ext.camping_details) setCampingDetails(ext.camping_details);
if (ext.age_restriction) setAgeRestriction(ext.age_restriction);
if (ext.social_links?.instagram) setSocialInstagram(ext.social_links.instagram);
if (ext.social_links?.facebook) setSocialFacebook(ext.social_links.facebook);
if (ext.social_links?.x) setSocialX(ext.social_links.x);
if (ext.social_links?.tiktok) setSocialTiktok(ext.social_links.tiktok);
```

**Step 3: Add hidden inputs + visible fields to the form**

- Replace the static `description` textarea with a controlled one using `value={description}` and `onChange={(e) => setDescription(e.target.value)}`
- Replace the static `ticketUrl` input with `value={ticketUrl}` controlled
- Replace the static `hasCamping` checkbox with `checked={hasCamping}`
- Add new visible inputs for `campingDetails`, `ageRestriction` after the hasCamping checkbox
- Add a "Social Links" section with 4 URL inputs for instagram, facebook, x, tiktok

Add hidden inputs so the server action receives these values:
```tsx
<input type="hidden" name="campingDetails" value={campingDetails} />
<input type="hidden" name="ageRestriction" value={ageRestriction} />
<input type="hidden" name="socialInstagram" value={socialInstagram} />
<input type="hidden" name="socialFacebook" value={socialFacebook} />
<input type="hidden" name="socialX" value={socialX} />
<input type="hidden" name="socialTiktok" value={socialTiktok} />
```

Or make them all visible form inputs (preferred — lets admin review/edit before saving).

**Step 4: Commit**

```bash
git add src/app/admin/festivals/new/new-festival-form.tsx
git commit -m "feat: pre-fill new festival form with scraped social links, camping, age restriction"
```

---

## Task 11: Update festival server actions

**Files:**
- Modify: `src/lib/actions/festival.ts`

**Step 1: Update createFestival to read new fields**

After the existing field reads (around line 41), add:
```typescript
const campingDetails = formData.get("campingDetails") as string;
const ageRestriction = formData.get("ageRestriction") as string;
const socialInstagram = formData.get("socialInstagram") as string;
const socialFacebook = formData.get("socialFacebook") as string;
const socialX = formData.get("socialX") as string;
const socialTiktok = formData.get("socialTiktok") as string;
```

Add to `prisma.festival.create` data:
```typescript
campingDetails: campingDetails || null,
ageRestriction: ageRestriction || null,
socialInstagram: socialInstagram || null,
socialFacebook: socialFacebook || null,
socialX: socialX || null,
socialTiktok: socialTiktok || null,
```

**Step 2: Update createFestival artists loop to include genre, day, stage**

The artists come from `artistsJson` as `Array<{ name: string; billing: string; genre?: string; day?: number; stage?: string }>`.

When creating `festivalArtist`:
```typescript
await prisma.festivalArtist.create({
  data: {
    festivalId: festival.id,
    artistId: artist.id,
    billing: (a.billing as "headliner" | "support") || "support",
    day: a.day ?? null,
    stage: a.stage || null,
  },
});
```

Also save genre to Artist when creating a new one:
```typescript
artist = await prisma.artist.create({ data: { name: a.name, slug: artistSlug, genre: a.genre || null } });
```

**Step 3: Update updateFestival to read and save new fields**

Read new fields from formData and include them in the `prisma.festival.update` data object.

**Step 4: Commit**

```bash
git add src/lib/actions/festival.ts
git commit -m "feat: persist social links, camping details, age restriction in festival create/update actions"
```

---

## Task 12: Update admin edit festival page

**Files:**
- Modify: `src/app/admin/festivals/[id]/page.tsx`

**Step 1: Add new inputs to the edit form**

After the existing `hasCamping` checkbox (around line 194), add:

```tsx
<div>
  <label htmlFor="campingDetails" className="block text-sm font-medium text-gray-700">
    Camping Details
  </label>
  <input
    id="campingDetails"
    name="campingDetails"
    type="text"
    defaultValue={festival.campingDetails ?? ""}
    placeholder="e.g. glamping available, day tickets"
    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
  />
</div>

<div>
  <label htmlFor="ageRestriction" className="block text-sm font-medium text-gray-700">
    Age Restriction
  </label>
  <input
    id="ageRestriction"
    name="ageRestriction"
    type="text"
    defaultValue={festival.ageRestriction ?? ""}
    placeholder="e.g. 18+, family-friendly, all ages"
    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
  />
</div>
```

Add a "Social Links" section with 4 URL inputs for Instagram, Facebook, X, TikTok using `defaultValue={festival.socialInstagram ?? ""}` etc.

**Step 2: Add day/stage columns to artist table**

In the artists table header, add `Day` and `Stage` columns after `Billing`.

In the table row, add:
```tsx
<td className="px-4 py-3 text-sm text-gray-600">{fa.day ?? "—"}</td>
<td className="px-4 py-3 text-sm text-gray-600">{fa.stage ?? "—"}</td>
```

Also add `genre` display on the artist row (read-only, since it's on the Artist model).

**Step 3: Commit**

```bash
git add src/app/admin/festivals/[id]/page.tsx
git commit -m "feat: show social links, camping, age restriction, artist day/stage in admin edit form"
```

---

## Task 13: Update public festival detail page

**Files:**
- Modify: `src/app/festivals/[slug]/page.tsx`

**Step 1: Show social links as icon buttons**

After the existing website/ticket link buttons (around line 131), add:
```tsx
<div className="mt-4 flex gap-3">
  {festival.socialInstagram && (
    <a href={festival.socialInstagram} target="_blank" rel="noopener noreferrer"
       className="text-sm text-gray-600 hover:text-pink-600 underline">Instagram</a>
  )}
  {festival.socialFacebook && (
    <a href={festival.socialFacebook} target="_blank" rel="noopener noreferrer"
       className="text-sm text-gray-600 hover:text-blue-600 underline">Facebook</a>
  )}
  {festival.socialX && (
    <a href={festival.socialX} target="_blank" rel="noopener noreferrer"
       className="text-sm text-gray-600 hover:text-gray-900 underline">X</a>
  )}
  {festival.socialTiktok && (
    <a href={festival.socialTiktok} target="_blank" rel="noopener noreferrer"
       className="text-sm text-gray-600 hover:text-gray-900 underline">TikTok</a>
  )}
</div>
```

**Step 2: Show campingDetails and ageRestriction**

In the info section, replace the bare camping yes/no:
```tsx
<div>
  <p className="text-sm text-gray-500">Camping</p>
  <p>{festival.hasCamping ? "Yes" : "No"}{festival.campingDetails ? ` — ${festival.campingDetails}` : ""}</p>
</div>
{festival.ageRestriction && (
  <div>
    <p className="text-sm text-gray-500">Age</p>
    <p>{festival.ageRestriction}</p>
  </div>
)}
```

**Step 3: Update prisma query to include new fields**

The `findUnique` call doesn't need to be changed since Prisma returns all scalar fields by default. Verify the new fields are available on `festival.*`.

**Step 4: Commit**

```bash
git add src/app/festivals/[slug]/page.tsx
git commit -m "feat: show social links, camping details, age restriction on public festival page"
```

---

## Task 14: Update search filters and queries

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/components/search-filters.tsx`

**Step 1: Add ageRestriction to SearchParams and query**

In `src/lib/queries.ts`:
```typescript
export interface SearchParams {
  artist?: string;
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  camping?: string;
  ageRestriction?: string;
}
```

Add to `searchFestivals`:
```typescript
if (params.ageRestriction) {
  where.ageRestriction = { contains: params.ageRestriction, mode: "insensitive" };
}
```

Remove the `priceMax` filter from SearchParams — it's no longer applicable since we're not scraping prices (prices deferred per design).

**Step 2: Add age restriction selector to SearchFilters**

In `src/components/search-filters.tsx`, add state and a select/input for age restriction:

```tsx
const [ageRestriction, setAgeRestriction] = useState(searchParams.get("ageRestriction") || "");
```

In the filter grid, add:
```tsx
<div>
  <label className="block text-sm font-medium text-gray-700">Age</label>
  <select
    value={ageRestriction}
    onChange={(e) => setAgeRestriction(e.target.value)}
    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
  >
    <option value="">Any</option>
    <option value="family-friendly">Family-friendly</option>
    <option value="18+">18+</option>
    <option value="all ages">All ages</option>
  </select>
</div>
```

Include in the URL params:
```typescript
if (ageRestriction) params.set("ageRestriction", ageRestriction);
```

**Step 3: Update festival-card.tsx to show ageRestriction badge**

In `FestivalCardProps`, add:
```typescript
ageRestriction: string | null;
```

After the camping badge, add:
```tsx
{festival.ageRestriction && (
  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
    {festival.ageRestriction}
  </span>
)}
```

Update the query in `src/lib/queries.ts` to select `ageRestriction` (it's already selected since Prisma returns all scalars).

**Step 4: Commit**

```bash
git add src/lib/queries.ts src/components/search-filters.tsx src/components/festival-card.tsx
git commit -m "feat: add age restriction filter to public festival search"
```

---

## Summary of changes

| Task | Files changed |
|---|---|
| 1. Schema | `prisma/schema.prisma` + migration |
| 2. Types | `src/lib/extraction.ts` |
| 3. Classify-page | `providers/gemini/classify-page.ts`, `providers/claude/classify-page.ts` |
| 4. Crawl | `src/lib/scraping/crawl-festival.ts` |
| 5. Extract (Claude) | `providers/claude/extract-festival.ts` |
| 6. Extract (Gemini) | `providers/gemini/extract-festival.ts` |
| 7. API route | `src/app/api/admin/scrape-festival/route.ts` |
| 8. Scrape progress UI | `src/app/admin/festivals/scrape-progress.tsx` |
| 9. Save artists action | `src/lib/actions/scrape.ts` |
| 10. New festival form | `src/app/admin/festivals/new/new-festival-form.tsx` |
| 11. Festival actions | `src/lib/actions/festival.ts` |
| 12. Admin edit page | `src/app/admin/festivals/[id]/page.tsx` |
| 13. Public detail page | `src/app/festivals/[slug]/page.tsx` |
| 14. Search filters | `src/lib/queries.ts`, `src/components/search-filters.tsx`, `src/components/festival-card.tsx` |
