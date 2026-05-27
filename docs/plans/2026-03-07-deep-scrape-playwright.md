# Deep Scrape with Playwright — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Deep Scrape" button that uses Playwright to render JS-heavy pages (e.g. Wix galleries with "Show More" buttons) and extract artists from the fully-rendered DOM.

**Architecture:** New API route `/api/admin/deep-scrape` accepts a single URL, launches Playwright headless Chromium, clicks "Show More"/"Load More" buttons until content stabilises, then feeds the rendered HTML through cheerio + existing `extractFestivalFromText()`. Results stream back via SSE to a new button in the existing `scrape-section.tsx`.

**Tech Stack:** Playwright (headless Chromium), existing cheerio parsing from `scrape-url.ts`, existing AI extraction via `extractFestivalFromText()`.

---

### Task 1: Install Playwright

**Step 1: Add playwright dependency**

Run:
```bash
npm install playwright
```

This installs the Playwright library. The Chromium browser binary will be downloaded on first use or can be installed with `npx playwright install chromium`.

**Step 2: Install Chromium browser**

Run:
```bash
npx playwright install chromium
```

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add playwright dependency"
```

---

### Task 2: Create `scrapeUrlWithBrowser()` function

**Files:**
- Create: `src/lib/scraping/scrape-url-browser.ts`

**Step 1: Write the browser scrape function**

This function launches Chromium, navigates to the URL, clicks "Show More" / "Load More" buttons until no more appear, then returns the rendered HTML parsed through the same cheerio logic as `scrapeUrl()`.

```typescript
import { chromium, type Browser } from "playwright";
import * as cheerio from "cheerio";
import { normalizeUrl } from "./scrape-url";
import type { ScrapeResult, LinkWithContext, ImageCandidate } from "./scrape-url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BROWSER_TIMEOUT_MS = 30_000;
const MAX_SHOW_MORE_CLICKS = 15;
const SETTLE_DELAY_MS = 2_000;

const SHOW_MORE_SELECTORS = [
  'button:has-text("Show More")',
  'button:has-text("Load More")',
  'button:has-text("View All")',
  'button:has-text("See All")',
  'button:has-text("View More")',
  'a:has-text("Show More")',
  'a:has-text("Load More")',
  '[data-testid*="show-more"]',
  '[data-testid*="load-more"]',
];

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// ---------------------------------------------------------------------------
// Helpers (mirrors scrape-url.ts logic for the rendered HTML)
// ---------------------------------------------------------------------------

function hasImageExtension(src: string): boolean {
  try {
    const pathname = new URL(src, "https://dummy.example").pathname.toLowerCase();
    return [...IMAGE_EXTENSIONS].some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function scrapeUrlWithBrowser(
  url: string,
  onLog?: (message: string) => void,
): Promise<ScrapeResult> {
  let browser: Browser | null = null;

  try {
    onLog?.("Launching headless browser...");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);

    onLog?.(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "networkidle" });

    // Click "Show More" buttons repeatedly
    let clicks = 0;
    for (let i = 0; i < MAX_SHOW_MORE_CLICKS; i++) {
      let clicked = false;
      for (const selector of SHOW_MORE_SELECTORS) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 1_000 })) {
            await btn.click();
            clicked = true;
            clicks++;
            onLog?.(`Clicked "${selector}" (${clicks} total)`);
            // Wait for new content to load
            await page.waitForTimeout(SETTLE_DELAY_MS);
            break;
          }
        } catch {
          // Button not found or not clickable — try next selector
        }
      }
      if (!clicked) break;
    }

    if (clicks > 0) {
      onLog?.(`Finished clicking — ${clicks} "Show More" click(s). Extracting content...`);
    } else {
      onLog?.("No 'Show More' buttons found. Extracting content...");
    }

    // Get the fully-rendered HTML
    const html = await page.content();
    await browser.close();
    browser = null;

    // Parse with cheerio — same logic as scrapeUrl()
    return parseHtml(html, url);
  } finally {
    if (browser) await browser.close();
  }
}

// ---------------------------------------------------------------------------
// HTML parsing (extracted from scrapeUrl pattern in scrape-url.ts)
// ---------------------------------------------------------------------------

function parseHtml(html: string, url: string): ScrapeResult {
  const $ = cheerio.load(html);
  const baseUrl = new URL(url);

  // Title
  const title = $("title").first().text().trim();

  // JSON-LD
  let jsonLd: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (content) {
      jsonLd = (jsonLd ? jsonLd + "\n" : "") + content;
    }
  });

  // Favicon
  let faviconUrl: string | null = null;
  const faviconHref =
    $('link[rel="apple-touch-icon"]').first().attr("href") ||
    $('link[rel="icon"][type="image/png"]').first().attr("href") ||
    $('link[rel="icon"]').first().attr("href") ||
    $('link[rel="shortcut icon"]').first().attr("href");
  if (faviconHref) {
    try {
      faviconUrl = new URL(faviconHref, url).toString();
    } catch { /* ignore */ }
  }

  // Images
  const images: ImageCandidate[] = [];
  const seenSrc = new Set<string>();

  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    try {
      const resolved = new URL(ogImage, url).toString();
      if (!seenSrc.has(resolved)) {
        seenSrc.add(resolved);
        images.push({ src: resolved, alt: "og:image", width: null, height: null });
      }
    } catch { /* skip */ }
  }

  $("img").each((_, el) => {
    const src =
      $(el).attr("data-src") ||
      $(el).attr("data-lazy-src") ||
      $(el).attr("data-lazy") ||
      $(el).attr("data-original") ||
      $(el).attr("src");
    if (!src || src.startsWith("data:")) return;

    let resolved: string;
    try {
      resolved = new URL(src, url).toString();
    } catch {
      return;
    }
    if (seenSrc.has(resolved)) return;

    const rawW = $(el).attr("width");
    const rawH = $(el).attr("height");
    const w = rawW ? parseInt(rawW, 10) : null;
    const h = rawH ? parseInt(rawH, 10) : null;

    const meetsSize =
      (w !== null && !isNaN(w) && w >= 400) ||
      (h !== null && !isNaN(h) && h >= 400);
    const noDimensions = w === null && h === null;

    if (meetsSize || (noDimensions && hasImageExtension(resolved))) {
      seenSrc.add(resolved);
      images.push({
        src: resolved,
        alt: $(el).attr("alt") ?? "",
        width: w !== null && !isNaN(w) ? w : null,
        height: h !== null && !isNaN(h) ? h : null,
      });
    }
  });

  // Links
  const links: LinkWithContext[] = [];
  const seenUrls = new Set<string>();
  const selfNorm = normalizeUrl(url);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("mailto:") || href.startsWith("javascript:") || href === "#") return;

    let resolved: string;
    try {
      resolved = new URL(href, url).toString();
    } catch {
      return;
    }

    try {
      if (new URL(resolved).hostname !== baseUrl.hostname) return;
    } catch {
      return;
    }

    const norm = normalizeUrl(resolved);
    if (norm === selfNorm || seenUrls.has(norm)) return;
    seenUrls.add(norm);

    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    links.push({ url: norm, text, context: "" });
  });

  // Clean text
  $("script, style, nav, footer, header, iframe, noscript, svg, form").remove();
  $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { url, text, jsonLd, links, images, title, faviconUrl };
}
```

**Step 2: Commit**

```bash
git add src/lib/scraping/scrape-url-browser.ts
git commit -m "feat: add scrapeUrlWithBrowser using Playwright"
```

---

### Task 3: Create deep-scrape API route

**Files:**
- Create: `src/app/api/admin/deep-scrape/route.ts`

**Step 1: Write the API route**

This follows the same SSE pattern as `scrape-festival/route.ts` but simpler — single URL, browser scrape, text extraction, return artists.

```typescript
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scrapeUrlWithBrowser } from "@/lib/scraping/scrape-url-browser";
import { extractFestivalFromText } from "@/lib/ai/extract-festival";

let activeDeepScrape = false;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { url: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.url) {
    return new Response(JSON.stringify({ error: "Missing url" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (activeDeepScrape) {
    return new Response(
      JSON.stringify({ error: "A deep scrape is already in progress." }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      activeDeepScrape = true;

      function sendEvent(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // client disconnected
        }
      }

      try {
        const scrapeResult = await scrapeUrlWithBrowser(body.url, (message) => {
          sendEvent("progress", { message });
        });

        sendEvent("progress", {
          message: `Page rendered. Found ${scrapeResult.images.length} images. Extracting artists...`,
        });

        const textResult = await extractFestivalFromText(
          [{ url: scrapeResult.url, text: scrapeResult.text }],
          [],
          body.url,
        );

        const artists = textResult.extraction.artists || [];

        sendEvent("progress", {
          message: `Extraction complete. Found ${artists.length} artist(s).`,
        });

        sendEvent("complete", {
          artists,
          pageTitle: scrapeResult.title,
          imageCount: scrapeResult.images.length,
          textLength: scrapeResult.text.length,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Deep scrape failed";
        sendEvent("error", { message });
      } finally {
        activeDeepScrape = false;
        controller.close();
      }
    },
    cancel() {
      activeDeepScrape = false;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

**Step 2: Commit**

```bash
git add src/app/api/admin/deep-scrape/route.ts
git commit -m "feat: add deep-scrape API route with SSE streaming"
```

---

### Task 4: Add "Deep Scrape" button to admin UI

**Files:**
- Modify: `src/app/admin/festivals/[id]/scrape-section.tsx`

**Step 1: Add deep scrape state and handler**

Add a new `handleDeepScrape` function and a URL input for the deep scrape target. The deep scrape button sits below the existing scrape UI. It streams SSE events the same way `ScrapeProgress` does, but simpler — just logs and a final artist list.

Add after the existing state declarations (line ~23):

```typescript
const [deepScrapeUrl, setDeepScrapeUrl] = useState("");
const [deepScraping, setDeepScraping] = useState(false);
const [deepLogs, setDeepLogs] = useState<string[]>([]);
```

Add the handler function after `handleSave`:

```typescript
async function handleDeepScrape() {
  if (!deepScrapeUrl.trim() || deepScraping) return;

  setDeepScraping(true);
  setDeepLogs([]);
  setError(null);
  setDone(false);

  try {
    const res = await fetch("/api/admin/deep-scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: deepScrapeUrl.trim() }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      let message = "Deep scrape failed";
      try { message = JSON.parse(text).error || message; } catch {}
      setError(message);
      setDeepScraping(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("event: ")) {
          currentEvent = trimmed.slice(7).trim();
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          let data: Record<string, unknown>;
          try { data = JSON.parse(trimmed.slice(6)); } catch { continue; }

          if (currentEvent === "progress" && data.message) {
            setDeepLogs((prev) => [...prev, data.message as string]);
          } else if (currentEvent === "complete") {
            setDeepLogs((prev) => [...prev, "Deep scrape complete."]);
            const artists = (data.artists as Artist[]) || [];
            setArtists(artists);
          } else if (currentEvent === "error") {
            setError((data.message as string) || "Deep scrape failed");
          }
          currentEvent = "";
        }
      }
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : "Deep scrape failed");
  } finally {
    setDeepScraping(false);
  }
}
```

**Step 2: Add UI elements**

Add before the closing `</div>` of the `bg-white` container (before `{done && (` block around line 120):

```tsx
{/* Deep Scrape */}
<div className="border-t pt-4 mt-4 space-y-3">
  <h3 className="text-sm font-semibold text-gray-700">
    Deep Scrape (JS-heavy pages)
  </h3>
  <p className="text-xs text-gray-500">
    Use for pages with &quot;Show More&quot; buttons that hide content behind JavaScript.
    Paste the specific page URL (e.g. the artists/lineup page).
  </p>
  <div className="flex items-end gap-3">
    <div className="flex-1">
      <input
        type="url"
        value={deepScrapeUrl}
        onChange={(e) => setDeepScrapeUrl(e.target.value)}
        disabled={deepScraping || scraping}
        placeholder="https://festival.com/artists"
        className="block w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
      />
    </div>
    <button
      type="button"
      onClick={handleDeepScrape}
      disabled={deepScraping || scraping || !deepScrapeUrl.trim()}
      className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
    >
      {deepScraping ? "Deep Scraping..." : "Deep Scrape"}
    </button>
  </div>

  {deepLogs.length > 0 && (
    <div className="bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-xs max-h-36 overflow-y-auto">
      {deepLogs.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )}
</div>
```

Note: add `scraping` as a prop or detect it from context. Since `ScrapeProgress` manages its own scraping state internally, the simplest approach is to add a `disabled` prop to the deep scrape section that's true when the main scrape is running. However, looking at the current code, the `scraping` state lives inside `ScrapeProgress` — so we just disable the deep scrape button when `deepScraping` is true and `artists.length > 0` (a scrape just completed). The main scrape and deep scrape won't conflict because both API routes have their own concurrency guards.

**Step 3: Commit**

```bash
git add src/app/admin/festivals/[id]/scrape-section.tsx
git commit -m "feat: add Deep Scrape button to admin scrape UI"
```

---

### Task 5: Test end-to-end

**Step 1: Run dev server**

```bash
npm run dev
```

**Step 2: Manual test**

1. Navigate to `/admin/festivals/<any-festival-id>`
2. Scroll to the "Scrape from Website" section
3. Find the "Deep Scrape" subsection
4. Paste `https://www.slamdunkfestival.com/artists` into the input
5. Click "Deep Scrape"
6. Verify:
   - Logs appear showing browser launch, navigation, "Show More" clicks
   - After completion, artist list populates with significantly more than 15 artists
   - Artists can be reviewed, edited, and saved as normal

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: deep scrape with Playwright for JS-heavy pages"
```
