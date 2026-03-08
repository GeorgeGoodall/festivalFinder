import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { chromium } from "playwright";

import {
  ScrapeResult,
  LinkWithContext,
  ImageCandidate,
  normalizeUrl,
  extractImageContext,
} from "./scrape-url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BROWSER_TIMEOUT_MS = 30_000;
const CLICK_SETTLE_MS = 1_500;
const SCROLL_SETTLE_MS = 1_200;
const MAX_CLICKS = 15;
const MAX_SCROLL_PASSES = 20;
const SCROLL_STEP_PX = 600;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SKIP_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wmv",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
]);

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** Selectors for "show more" type buttons */
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

// ---------------------------------------------------------------------------
// Internal helpers (mirrored from scrape-url.ts for cheerio parsing)
// ---------------------------------------------------------------------------

function shouldSkipUrl(href: string): boolean {
  if (!href) return true;
  if (
    href.startsWith("mailto:") ||
    href.startsWith("javascript:") ||
    href === "#"
  ) {
    return true;
  }
  try {
    const ext = new URL(href, "https://dummy.example").pathname
      .split(".")
      .pop();
    if (ext && SKIP_EXTENSIONS.has(`.${ext.toLowerCase()}`)) return true;
  } catch {
    // ignore
  }
  return false;
}

function extractSurroundingContext(
  $el: ReturnType<cheerio.CheerioAPI>,
  $: cheerio.CheerioAPI
): string {
  const parent = $el.closest("p, li, div, td, section, article");
  const raw = (parent.length ? parent : $el)
    .text()
    .replace(/\s+/g, " ")
    .trim();
  if (raw.length <= 200) return raw;
  const linkText = $el.text().trim();
  const idx = raw.indexOf(linkText);
  if (idx === -1) return raw.slice(0, 200);
  const start = Math.max(0, idx - 80);
  const end = Math.min(raw.length, idx + linkText.length + 80);
  return raw.slice(start, end).trim();
}

function hasImageExtension(src: string): boolean {
  try {
    const pathname = new URL(src, "https://dummy.example").pathname.toLowerCase();
    return [...IMAGE_EXTENSIONS].some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parse rendered HTML with cheerio (same logic as scrapeUrl)
// ---------------------------------------------------------------------------

function parseRenderedHtml(html: string, url: string): ScrapeResult {
  const $ = cheerio.load(html);
  const baseUrl = new URL(url);

  // --- Title ---
  const title = $("title").first().text().trim();

  // --- JSON-LD ---
  let jsonLd: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (content) {
      jsonLd = (jsonLd ? jsonLd + "\n" : "") + content;
    }
  });

  // --- Favicon ---
  let faviconUrl: string | null = null;
  const appleIconHref = $('link[rel="apple-touch-icon"]').first().attr("href");
  const pngIconHref = $('link[rel="icon"][type="image/png"]')
    .first()
    .attr("href");
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

  // --- Images ---
  const images: ImageCandidate[] = [];
  const seenSrc = new Set<string>();

  // og:image first
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    try {
      const resolved = new URL(ogImage, url).toString();
      if (!seenSrc.has(resolved)) {
        seenSrc.add(resolved);
        images.push({
          src: resolved,
          alt: "og:image",
          width: null,
          height: null,
          surroundingContext: "",
        });
      }
    } catch {
      // skip invalid og:image
    }
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
        surroundingContext: extractImageContext(el, $),
      });
    }
  });

  // --- Links ---
  const links: LinkWithContext[] = [];
  const seenUrls = new Set<string>();
  const selfNorm = normalizeUrl(url);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || shouldSkipUrl(href)) return;

    let resolved: string;
    try {
      resolved = new URL(href, url).toString();
    } catch {
      return;
    }

    // Same domain only
    try {
      const linkHost = new URL(resolved).hostname;
      if (linkHost !== baseUrl.hostname) return;
    } catch {
      return;
    }

    const norm = normalizeUrl(resolved);

    // Skip self-links and duplicates
    if (norm === selfNorm) return;
    if (seenUrls.has(norm)) return;
    seenUrls.add(norm);

    const $el = $(el);
    const text = $el.text().replace(/\s+/g, " ").trim();
    const context = extractSurroundingContext($el, $);

    links.push({ url: norm, text, context });
  });

  // --- Clean text ---
  $(
    "script, style, nav, footer, header, iframe, noscript, svg, form"
  ).remove();
  $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { url, text, jsonLd, links, images, title, faviconUrl, hasShowMore: false, isJsRendered: false };
}

// ---------------------------------------------------------------------------
// Text extraction and snapshot merging
// ---------------------------------------------------------------------------

/**
 * Extract cleaned body text from HTML (without full structural parsing).
 * Used for cheap snapshot comparisons during scrolling.
 */
function extractBodyText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, iframe, noscript, svg, form").remove();
  $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();
  return $("body").text().replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Merge multiple text snapshots into a single combined text.
 *
 * Uses 4-gram novelty detection: processes snapshots longest-first (most
 * content as the base), then scans each remaining snapshot for any sequence
 * of 4 consecutive words not already seen. When found, the surrounding
 * context (~12 words) is appended with a " ... " separator.
 *
 * This captures content that was visible at one scroll position but removed
 * later (e.g. a WordPress JS filter that hides items after scrolling), while
 * avoiding duplicating content that is stable across snapshots.
 */
function mergeTextSnapshots(snapshots: string[]): string {
  if (snapshots.length === 0) return "";
  if (snapshots.length === 1) return snapshots[0];

  // Longest-first so the richest snapshot becomes the base
  const sorted = [...snapshots].sort((a, b) => b.length - a.length);
  const base = sorted[0];

  // Seed the seen-set from the base snapshot
  const seen = new Set<string>();
  const baseWords = base.split(" ");
  for (let i = 0; i + 3 < baseWords.length; i++) {
    seen.add(`${baseWords[i]} ${baseWords[i + 1]} ${baseWords[i + 2]} ${baseWords[i + 3]}`);
  }

  let result = base;

  for (const snapshot of sorted.slice(1)) {
    const words = snapshot.split(" ");
    let i = 0;
    while (i + 3 < words.length) {
      const gram = `${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`;
      if (!seen.has(gram)) {
        // Novel 4-gram — append surrounding context
        const end = Math.min(i + 12, words.length);
        const chunk = words.slice(i, end).join(" ");
        result += " ... " + chunk;
        // Mark new 4-grams as seen so we don't re-add adjacent overlaps
        for (let j = i; j + 3 < end; j++) {
          seen.add(`${words[j]} ${words[j + 1]} ${words[j + 2]} ${words[j + 3]}`);
        }
        i = end;
      } else {
        i++;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main browser-based scrape function
// ---------------------------------------------------------------------------

/**
 * Launch headless Chromium, navigate to the URL, click any "Show More" buttons
 * to fully expand the page, then parse the rendered HTML with cheerio.
 */
export async function scrapeUrlWithBrowser(
  url: string,
  onLog?: (message: string) => void
): Promise<ScrapeResult> {
  const log = onLog ?? (() => {});

  log(`Launching headless browser for ${url}`);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);

    log("Navigating to page...");
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });

    // Capture pre-JS HTML immediately (before any framework modifies the DOM).
    // Server-rendered sites (e.g. WordPress) often have MORE content here than
    // after JS runs (which may apply filters, hide items, etc.).
    const preJsHtml = await page.content();
    const textSnapshots: string[] = [extractBodyText(preJsHtml)];
    log(`DOM ready — captured pre-JS snapshot (${preJsHtml.length.toLocaleString()} bytes)`);

    // Wait for JS frameworks to render dynamic content (Wix, React, etc.)
    await page.waitForTimeout(2_000);

    const pageTitle = await page.title();
    log(`Page settled${pageTitle ? `: "${pageTitle}"` : ""}`);

    // Snapshot after JS settles
    textSnapshots.push(extractBodyText(await page.content()));

    // --- Scroll + click loop ---
    // Scroll down incrementally to trigger lazy-load, clicking any "Show More"
    // buttons that appear along the way. Repeat until page height stabilises.
    let totalClicks = 0;
    let lastHeight = 0;
    let stableCount = 0;

    for (let pass = 0; pass < MAX_SCROLL_PASSES; pass++) {
      // Click any visible "Show More" / "Load More" buttons before scrolling
      for (const selector of SHOW_MORE_SELECTORS) {
        if (totalClicks >= MAX_CLICKS) break;
        try {
          const button = page.locator(selector).first();
          if (await button.isVisible({ timeout: 300 })) {
            log(`Clicking "Show More" button (${totalClicks + 1})...`);
            await button.click();
            totalClicks++;
            await page.waitForTimeout(CLICK_SETTLE_MS);
          }
        } catch {
          // not found or not clickable — continue
        }
      }

      // Scroll down by one step
      await page.evaluate((step) => window.scrollBy(0, step), SCROLL_STEP_PX);
      await page.waitForTimeout(SCROLL_SETTLE_MS);

      // Snapshot after each scroll — captures content that may appear or
      // disappear as JS responds to scroll position
      textSnapshots.push(extractBodyText(await page.content()));

      // Check if we've reached the bottom and page height has stabilised
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      const scrollY = await page.evaluate(() => window.scrollY + window.innerHeight);

      if (currentHeight === lastHeight) {
        stableCount++;
        if (stableCount >= 2) {
          // Height unchanged for 2 consecutive passes — we're done
          log(`Page fully scrolled (${pass + 1} passes, ${totalClicks} button click(s)).`);
          break;
        }
      } else {
        stableCount = 0;
        log(`Scrolling... (${Math.round((scrollY / currentHeight) * 100)}% of page)`);
      }
      lastHeight = currentHeight;

      if (scrollY >= currentHeight) {
        // Reached the bottom — do one final button check then stop
        for (const selector of SHOW_MORE_SELECTORS) {
          if (totalClicks >= MAX_CLICKS) break;
          try {
            const button = page.locator(selector).first();
            if (await button.isVisible({ timeout: 300 })) {
              log(`Clicking "Show More" button (${totalClicks + 1})...`);
              await button.click();
              totalClicks++;
              await page.waitForTimeout(CLICK_SETTLE_MS);
            }
          } catch {
            // not found
          }
        }
        // Scroll back to bottom in case new content loaded
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(SCROLL_SETTLE_MS);
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === currentHeight) {
          log(`Reached bottom of page (${pass + 1} passes, ${totalClicks} button click(s)).`);
          break;
        }
        lastHeight = newHeight;
      }
    }

    // --- Final snapshot + merge ---
    // Parse the final rendered HTML for structural fields (links, images, etc.)
    // then override .text with the merged union of all scroll snapshots.
    log("Extracting rendered HTML...");
    const finalHtml = await page.content();
    textSnapshots.push(extractBodyText(finalHtml));

    // Use the pre-JS HTML for structural fields if it has more links/images
    // (JS frameworks sometimes strip server-rendered links during hydration)
    const preJsResult = parseRenderedHtml(preJsHtml, url);
    const finalResult = parseRenderedHtml(finalHtml, url);
    const structural = preJsResult.links.length >= finalResult.links.length
      ? preJsResult
      : finalResult;

    // Merge all text snapshots — union of everything ever visible on the page
    const mergedText = mergeTextSnapshots(textSnapshots);
    log(
      `Merged ${textSnapshots.length} snapshots — ${mergedText.length.toLocaleString()} chars` +
      ` (longest single: ${Math.max(...textSnapshots.map((s) => s.length)).toLocaleString()})`,
    );
    log(`Extraction complete — ${structural.links.length} links, ${structural.images.length} images.`);

    return { ...structural, text: mergedText };
  } finally {
    await browser.close();
  }
}
