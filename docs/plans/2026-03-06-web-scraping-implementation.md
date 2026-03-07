# Web Scraping Artist Extraction - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the ability to scrape festival lineup pages and extract artists via LLM, as an alternative to poster image extraction.

**Architecture:** Admin pastes a lineup URL. Server fetches the page, cleans HTML with cheerio, sends cleaned text to Claude Haiku for validation + artist extraction via tool-use. Content hash stored for scheduled change detection via Vercel cron.

**Tech Stack:** Next.js 16 (App Router), Prisma 7, cheerio (new dep), @anthropic-ai/sdk (existing), Vercel cron

---

### Task 1: Add cheerio dependency

**Step 1: Install cheerio**

Run: `npm install cheerio`

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add cheerio dependency for HTML parsing"
```

---

### Task 2: Add schema fields to Festival model

**Files:**
- Modify: `prisma/schema.prisma` (Festival model, around line 41-66)

**Step 1: Add new fields to the Festival model**

Add these 3 fields after `ticketUrl` (line 56) and before `status` (line 57):

```prisma
  lineupUrl      String?   @map("lineup_url")
  lineupHash     String?   @map("lineup_hash")
  lastScrapedAt  DateTime? @map("last_scraped_at")
```

**Step 2: Run migration**

Run: `npx prisma migrate dev --name add-lineup-scraping-fields`

Expected: Migration succeeds, new columns added to `festivals` table.

**Step 3: Commit**

```bash
git add prisma/
git commit -m "feat: add lineupUrl, lineupHash, lastScrapedAt fields to Festival"
```

---

### Task 3: Create the scraping library

**Files:**
- Create: `src/lib/scraping.ts`

**Step 1: Create `src/lib/scraping.ts`**

This file has 4 exported functions:

```typescript
import * as cheerio from "cheerio";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/**
 * Fetch a URL and return the raw HTML string.
 * Falls back to checking for JSON-LD structured data if the body looks empty/JS-only.
 */
export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FestivalFinder/1.0; +https://festivalfinder.uk)",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Strip non-content elements from HTML and return clean text.
 * Also extracts JSON-LD data if present.
 */
export function cleanHtml(html: string): { text: string; jsonLd: string | null } {
  const $ = cheerio.load(html);

  // Extract JSON-LD before stripping scripts
  let jsonLd: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (content) {
      jsonLd = (jsonLd ? jsonLd + "\n" : "") + content;
    }
  });

  // Remove non-content elements
  $("script, style, nav, footer, header, iframe, noscript, svg, form").remove();
  $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

  // Get text, collapse whitespace
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, jsonLd };
}

/**
 * SHA-256 hash of the cleaned text content for change detection.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Combined validation + extraction LLM call.
 * Returns null if the page is not a lineup page.
 * Returns extracted artists if it is.
 */
export interface ScrapeExtractionResult {
  isLineupPage: boolean;
  rejectionReason?: string;
  artists: Array<{ name: string; billing: "headliner" | "support" }>;
}

export interface ScrapeExtractionResponse {
  extraction: ScrapeExtractionResult;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

const scrapeExtractionTool: Anthropic.Messages.Tool = {
  name: "extract_lineup",
  description:
    "Validate whether text is from a festival lineup page and extract artist names",
  input_schema: {
    type: "object" as const,
    properties: {
      is_lineup_page: {
        type: "boolean",
        description:
          "true if this text appears to be from a festival lineup/artist listing page",
      },
      rejection_reason: {
        type: "string",
        description:
          "If is_lineup_page is false, explain why (e.g. 'This is a ticket purchase page'). Empty string if is_lineup_page is true.",
      },
      artists: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Artist or band name" },
            billing: {
              type: "string",
              enum: ["headliner", "support"],
              description:
                "headliner = largest/most prominent names (typically top-billed), support = all others",
            },
          },
          required: ["name", "billing"],
        },
        description:
          "All artists/bands found on the page. Empty array if is_lineup_page is false.",
      },
    },
    required: ["is_lineup_page", "rejection_reason", "artists"],
  },
};

export async function extractFromPage(
  cleanedText: string,
  jsonLd: string | null
): Promise<ScrapeExtractionResponse> {
  let content = `Analyze this text extracted from a festival website page.\n\n`;
  if (jsonLd) {
    content += `JSON-LD structured data found on the page:\n${jsonLd}\n\n`;
  }
  content += `Page text content:\n${cleanedText.slice(0, 15000)}`;
  content += `\n\nRules:
- First determine if this is a festival lineup/artist listing page
- If it is NOT a lineup page, set is_lineup_page to false and explain why in rejection_reason
- If it IS a lineup page, extract ALL artist/band names
- "headliner" = most prominent/top-billed acts, "support" = all other artists
- Do NOT include stage names, venue areas, sponsors, or generic text as artists
- If an artist name includes featuring/collaboration (e.g. "Artist A feat. Artist B"), split into SEPARATE entries with the same billing`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    tools: [scrapeExtractionTool],
    tool_choice: { type: "tool", name: "extract_lineup" },
    messages: [{ role: "user", content }],
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("No tool_use block in AI response");
  }

  const input = toolBlock.input as {
    is_lineup_page: boolean;
    rejection_reason: string;
    artists: Array<{ name: string; billing: "headliner" | "support" }>;
  };

  return {
    extraction: {
      isLineupPage: input.is_lineup_page,
      rejectionReason: input.rejection_reason || undefined,
      artists: input.artists || [],
    },
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-haiku-4-5-20251001",
    },
  };
}
```

**Step 2: Commit**

```bash
git add src/lib/scraping.ts
git commit -m "feat: add scraping library with fetch, clean, hash, and LLM extraction"
```

---

### Task 4: Create the scrape lineup API route

**Files:**
- Create: `src/app/api/admin/scrape-lineup/route.ts`

This route is called by the admin UI when the admin clicks "Scrape Lineup". It fetches the URL, cleans it, validates + extracts with the LLM, and returns the results. Does NOT save artists — that's done when the admin submits the form.

**Step 1: Create the API route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchPage, cleanHtml, hashContent, extractFromPage } from "@/lib/scraping";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, festivalId } = await req.json();

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const html = await fetchPage(url);
    const { text, jsonLd } = cleanHtml(html);

    if (text.length < 50) {
      return NextResponse.json({
        error:
          "Page returned very little text content. This site may require JavaScript rendering, which is not currently supported.",
      }, { status: 422 });
    }

    const { extraction, usage } = await extractFromPage(text, jsonLd);

    // Log API usage
    await prisma.apiUsageLog.create({
      data: {
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        festivalId: festivalId || null,
        festivalName: null,
        success: extraction.isLineupPage,
      },
    });

    // If we have a festivalId, update the lineup hash
    if (festivalId) {
      const hash = hashContent(text);
      await prisma.festival.update({
        where: { id: festivalId },
        data: {
          lineupUrl: url,
          lineupHash: hash,
          lastScrapedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ extraction });
  } catch (error) {
    return NextResponse.json(
      { error: "Scraping failed", details: String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/admin/scrape-lineup/route.ts
git commit -m "feat: add scrape-lineup API route for admin lineup extraction"
```

---

### Task 5: Create the scrape server action

**Files:**
- Create: `src/lib/actions/scrape.ts`

This server action saves the lineup URL and merges scraped artists into an existing festival (used from the edit page).

**Step 1: Create the server action**

```typescript
"use server";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";

export async function saveScrapedArtists(
  festivalId: string,
  artists: Array<{ name: string; billing: "headliner" | "support" }>
) {
  const existingLinks = await prisma.festivalArtist.findMany({
    where: { festivalId },
    include: { artist: { select: { slug: true } } },
  });
  const existingSlugs = new Set(existingLinks.map((link) => link.artist.slug));

  let added = 0;
  for (const a of artists) {
    const slug = slugify(a.name);
    if (existingSlugs.has(slug)) continue;

    let artist = await prisma.artist.findUnique({ where: { slug } });
    if (!artist) {
      artist = await prisma.artist.create({ data: { name: a.name, slug } });
    }

    await prisma.festivalArtist.create({
      data: {
        festivalId,
        artistId: artist.id,
        billing: a.billing || "support",
      },
    });
    added++;
  }

  revalidatePath(`/admin/festivals/${festivalId}`);
  return { added, existing: existingSlugs.size };
}
```

**Step 2: Commit**

```bash
git add src/lib/actions/scrape.ts
git commit -m "feat: add saveScrapedArtists server action"
```

---

### Task 6: Add scraping UI to festival edit page

**Files:**
- Create: `src/app/admin/festivals/[id]/scrape-section.tsx`
- Modify: `src/app/admin/festivals/[id]/page.tsx`

**Step 1: Create the ScrapeSection client component**

`src/app/admin/festivals/[id]/scrape-section.tsx`:

```tsx
"use client";

import { useState } from "react";
import { saveScrapedArtists } from "@/lib/actions/scrape";

interface ScrapeSectionProps {
  festivalId: string;
  lineupUrl: string | null;
  lastScrapedAt: Date | null;
}

interface Artist {
  name: string;
  billing: "headliner" | "support";
}

export function ScrapeSection({ festivalId, lineupUrl, lastScrapedAt }: ScrapeSectionProps) {
  const [url, setUrl] = useState(lineupUrl ?? "");
  const [scraping, setScraping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleScrape(forceExtract = false) {
    if (!url.trim()) return;
    setScraping(true);
    setWarning(null);
    setError(null);
    setArtists([]);
    setDone(false);

    try {
      const res = await fetch("/api/admin/scrape-lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), festivalId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Scraping failed");
        return;
      }

      if (!data.extraction.isLineupPage && !forceExtract) {
        setWarning(
          data.extraction.rejectionReason ||
            "This doesn't appear to be a lineup page."
        );
        // Still show any artists found so admin can choose to use them
        if (data.extraction.artists?.length) {
          setArtists(data.extraction.artists);
        }
        return;
      }

      setArtists(data.extraction.artists || []);
    } catch {
      setError("Failed to scrape. Check the URL and try again.");
    } finally {
      setScraping(false);
    }
  }

  async function handleSave() {
    if (artists.length === 0) return;
    setSaving(true);
    try {
      await saveScrapedArtists(festivalId, artists);
      setDone(true);
      setArtists([]);
    } catch {
      setError("Failed to save artists.");
    } finally {
      setSaving(false);
    }
  }

  function updateArtist(index: number, field: keyof Artist, value: string) {
    const updated = [...artists];
    updated[index] = { ...updated[index], [field]: value };
    setArtists(updated);
  }

  function removeArtist(index: number) {
    setArtists(artists.filter((_, i) => i !== index));
  }

  return (
    <div className="max-w-2xl mt-8">
      <h2 className="text-xl font-bold mb-4">Scrape Lineup from Website</h2>

      <div className="bg-white p-4 rounded-lg shadow space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="lineupUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Lineup Page URL
            </label>
            <input
              id="lineupUrl"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://festival.com/lineup"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <button
            type="button"
            onClick={() => handleScrape()}
            disabled={scraping || !url.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {scraping ? "Scraping..." : "Scrape Lineup"}
          </button>
        </div>

        {lastScrapedAt && (
          <p className="text-xs text-gray-500">
            Last scraped: {new Date(lastScrapedAt).toLocaleString()}
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>
        )}

        {warning && (
          <div className="bg-yellow-50 p-3 rounded space-y-2">
            <p className="text-sm text-yellow-800">{warning}</p>
            <button
              type="button"
              onClick={() => handleScrape(true)}
              className="text-sm text-yellow-700 underline hover:text-yellow-900"
            >
              Extract anyway
            </button>
          </div>
        )}

        {artists.length > 0 && (
          <div className="border rounded p-4 space-y-3">
            <h3 className="font-medium">
              Found {artists.length} artists - Review & Save
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {artists.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.name}
                    onChange={(e) => updateArtist(i, "name", e.target.value)}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  <select
                    value={a.billing}
                    onChange={(e) => updateArtist(i, "billing", e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="headliner">Headliner</option>
                    <option value="support">Support</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeArtist(i)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Artists to Festival"}
            </button>
          </div>
        )}

        {done && (
          <p className="text-sm text-green-700 font-medium">
            Artists saved! Refresh the page to see the updated lineup.
          </p>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add ScrapeSection to the edit page**

In `src/app/admin/festivals/[id]/page.tsx`, add the import at the top:

```typescript
import { ScrapeSection } from "./scrape-section";
```

Then add the component between the `<PosterSection>` and the Artists Section comment (around line 249). Pass the required props:

```tsx
<ScrapeSection
  festivalId={id}
  lineupUrl={festival.lineupUrl}
  lastScrapedAt={festival.lastScrapedAt}
/>
```

**Step 3: Commit**

```bash
git add src/app/admin/festivals/\[id\]/scrape-section.tsx src/app/admin/festivals/\[id\]/page.tsx
git commit -m "feat: add scrape lineup UI to festival edit page"
```

---

### Task 7: Add scraping option to new festival form

**Files:**
- Modify: `src/app/admin/festivals/new/new-festival-form.tsx`

**Step 1: Add lineup URL scraping to the new festival form**

In `new-festival-form.tsx`, add a new section between Step 1 (Poster Upload) and Step 2 (Festival Details). This mirrors the poster upload flow: admin pastes a URL, clicks "Scrape", reviews extracted artists, then submits the form.

Add state variables alongside the existing ones (around line 22-34):

```typescript
const [lineupUrl, setLineupUrl] = useState("");
const [scrapingUrl, setScrapingUrl] = useState(false);
const [scrapeWarning, setScrapeWarning] = useState<string | null>(null);
```

Add the scrape handler function after `handleExtract`:

```typescript
async function handleScrapeUrl() {
  if (!lineupUrl.trim()) return;
  setScrapingUrl(true);
  setScrapeWarning(null);

  try {
    const res = await fetch("/api/admin/scrape-lineup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: lineupUrl.trim() }),
    });
    const data = await res.json();

    if (!res.ok) {
      setScrapeWarning(data.error || "Scraping failed");
      setScrapingUrl(false);
      return;
    }

    if (!data.extraction.isLineupPage) {
      setScrapeWarning(
        data.extraction.rejectionReason || "This doesn't appear to be a lineup page."
      );
    }

    if (data.extraction.artists?.length) {
      setArtists(data.extraction.artists);
      setExtracted(true);
    }
  } catch {
    setScrapeWarning("Failed to scrape. Check the URL and try again.");
  } finally {
    setScrapingUrl(false);
  }
}
```

Add the UI section in JSX after the poster upload section (after the closing `</div>` around line 148), before Step 2:

```tsx
{/* Step 1b: Scrape from URL */}
<div className="max-w-2xl bg-white p-6 rounded-lg shadow mb-6">
  <h2 className="text-lg font-bold mb-2">
    Or: Scrape Lineup from Website
  </h2>
  <p className="text-sm text-gray-700 mb-4">
    Paste a festival lineup page URL and we'll extract the artist names.
  </p>

  <div className="flex items-end gap-3">
    <div className="flex-1">
      <input
        type="url"
        value={lineupUrl}
        onChange={(e) => setLineupUrl(e.target.value)}
        placeholder="https://festival.com/lineup"
        className="block w-full rounded border border-gray-300 px-3 py-2"
      />
    </div>
    <button
      type="button"
      onClick={handleScrapeUrl}
      disabled={scrapingUrl || !lineupUrl.trim()}
      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
    >
      {scrapingUrl ? "Scraping..." : "Scrape Lineup"}
    </button>
  </div>

  {scrapeWarning && (
    <p className="mt-2 text-sm text-yellow-800 bg-yellow-50 p-3 rounded">
      {scrapeWarning}
    </p>
  )}
</div>
```

Also add a hidden input for lineupUrl inside the form, near the other hidden inputs (around line 158-167):

```tsx
{lineupUrl && (
  <input type="hidden" name="lineupUrl" value={lineupUrl} />
)}
```

**Step 2: Update `createFestival` server action**

In `src/lib/actions/festival.ts`, read the `lineupUrl` from form data (around line 21) and include it in the create data.

Add after `const artistsJson = ...` (line 21):

```typescript
const lineupUrl = formData.get("lineupUrl") as string;
```

Add to the `data` object in `prisma.festival.create` (around line 49):

```typescript
lineupUrl: lineupUrl || null,
```

**Step 3: Commit**

```bash
git add src/app/admin/festivals/new/new-festival-form.tsx src/lib/actions/festival.ts
git commit -m "feat: add lineup URL scraping to new festival form"
```

---

### Task 8: Create the cron job for scheduled re-checking

**Files:**
- Create: `src/app/api/cron/scrape-lineups/route.ts`
- Create or modify: `vercel.json` (add cron config)

**Step 1: Create the cron API route**

`src/app/api/cron/scrape-lineups/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchPage, cleanHtml, hashContent, extractFromPage } from "@/lib/scraping";
import { slugify } from "@/lib/utils";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const festivals = await prisma.festival.findMany({
    where: { lineupUrl: { not: null } },
    select: {
      id: true,
      name: true,
      lineupUrl: true,
      lineupHash: true,
    },
  });

  const results: Array<{
    festival: string;
    status: string;
    artistsAdded?: number;
  }> = [];

  for (const festival of festivals) {
    try {
      const html = await fetchPage(festival.lineupUrl!);
      const { text, jsonLd } = cleanHtml(html);

      if (text.length < 50) {
        results.push({ festival: festival.name, status: "skipped_no_content" });
        continue;
      }

      const hash = hashContent(text);

      // Skip if content unchanged
      if (hash === festival.lineupHash) {
        await prisma.festival.update({
          where: { id: festival.id },
          data: { lastScrapedAt: new Date() },
        });
        results.push({ festival: festival.name, status: "unchanged" });
        continue;
      }

      // Content changed — re-extract
      const { extraction, usage } = await extractFromPage(text, jsonLd);

      await prisma.apiUsageLog.create({
        data: {
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          festivalId: festival.id,
          festivalName: festival.name,
          success: extraction.isLineupPage,
        },
      });

      if (!extraction.isLineupPage) {
        results.push({ festival: festival.name, status: "not_lineup_page" });
        continue;
      }

      // Merge new artists (don't remove existing ones)
      const existingLinks = await prisma.festivalArtist.findMany({
        where: { festivalId: festival.id },
        include: { artist: { select: { slug: true } } },
      });
      const existingSlugs = new Set(existingLinks.map((l) => l.artist.slug));

      let added = 0;
      for (const a of extraction.artists) {
        const slug = slugify(a.name);
        if (existingSlugs.has(slug)) continue;

        let artist = await prisma.artist.findUnique({ where: { slug } });
        if (!artist) {
          artist = await prisma.artist.create({ data: { name: a.name, slug } });
        }

        await prisma.festivalArtist.create({
          data: {
            festivalId: festival.id,
            artistId: artist.id,
            billing: a.billing || "support",
          },
        });
        added++;
      }

      // Update hash and timestamp
      await prisma.festival.update({
        where: { id: festival.id },
        data: { lineupHash: hash, lastScrapedAt: new Date() },
      });

      results.push({ festival: festival.name, status: "updated", artistsAdded: added });

      // Small delay between festivals to be polite
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      results.push({
        festival: festival.name,
        status: `error: ${String(error)}`,
      });
    }
  }

  return NextResponse.json({ processed: festivals.length, results });
}
```

**Step 2: Create or update `vercel.json`**

Check if `vercel.json` exists first. Create it with:

```json
{
  "crons": [
    {
      "path": "/api/cron/scrape-lineups",
      "schedule": "0 6 * * *"
    }
  ]
}
```

This runs daily at 6am UTC.

**Step 3: Commit**

```bash
git add src/app/api/cron/scrape-lineups/route.ts vercel.json
git commit -m "feat: add scheduled cron job for lineup re-checking"
```

---

### Task 9: Update the festival update action to save lineupUrl

**Files:**
- Modify: `src/lib/actions/festival.ts` (updateFestival function, around line 94)

**Step 1: Read lineupUrl from form data in updateFestival**

Add after `const status = formData.get("status") as string;` (line 106):

```typescript
const lineupUrl = formData.get("lineupUrl") as string;
```

Add `lineupUrl: lineupUrl || null,` to the data object in `prisma.festival.update` (around line 130).

**Step 2: Add a hidden lineupUrl input in the edit page form**

In `src/app/admin/festivals/[id]/page.tsx`, inside the `<form>` tag (after the opening form tag, around line 65), add:

```tsx
<input type="hidden" name="lineupUrl" value={festival.lineupUrl ?? ""} />
```

Note: The ScrapeSection component updates the lineupUrl via the API route directly, but we need the hidden input so that the updateFestival action doesn't null it out when the form is submitted.

**Step 3: Commit**

```bash
git add src/lib/actions/festival.ts src/app/admin/festivals/\[id\]/page.tsx
git commit -m "feat: persist lineupUrl when updating festival"
```

---

### Task 10: Manual testing and verification

**Step 1: Run the dev server**

Run: `npm run dev`

**Step 2: Test the new festival flow**

1. Go to `/admin/festivals/new`
2. Paste a real festival lineup URL (e.g. a Glastonbury or Reading lineup page)
3. Click "Scrape Lineup"
4. Verify artists appear in the review list
5. Submit the form and verify festival + artists are created

**Step 3: Test the edit page flow**

1. Go to an existing festival's edit page
2. Scroll to "Scrape Lineup from Website"
3. Paste a URL and click "Scrape Lineup"
4. Review artists and click "Save Artists to Festival"
5. Verify new artists appear in the lineup table

**Step 4: Test validation**

1. Try scraping a non-lineup URL (e.g. a festival homepage or ticket page)
2. Verify the warning message appears
3. Verify "Extract anyway" option works

**Step 5: Commit any fixes**

```bash
git add -u
git commit -m "fix: address issues found during scraping manual testing"
```
