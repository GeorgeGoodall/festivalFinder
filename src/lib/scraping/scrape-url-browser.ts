import * as cheerio from "cheerio";
import { chromium } from "playwright";

import {
  ScrapeResult,
  LinkWithContext,
  ImageCandidate,
  normalizeUrl,
} from "./scrape-url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BROWSER_TIMEOUT_MS = 30_000;
const CLICK_SETTLE_MS = 2_000;
const MAX_CLICKS = 15;

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

  return { url, text, jsonLd, links, images, title, faviconUrl, hasShowMore: false };
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

    log("Navigating to page (waiting for network idle)...");
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: BROWSER_TIMEOUT_MS,
    });

    // --- Click "Show More" buttons ---
    let totalClicks = 0;

    for (let i = 0; i < MAX_CLICKS; i++) {
      let clicked = false;

      for (const selector of SHOW_MORE_SELECTORS) {
        try {
          const button = page.locator(selector).first();
          if (await button.isVisible({ timeout: 500 })) {
            log(
              `Clicking "${selector}" (click ${totalClicks + 1}/${MAX_CLICKS})`
            );
            await button.click();
            totalClicks++;
            clicked = true;
            // Wait for content to settle after click
            await page.waitForTimeout(CLICK_SETTLE_MS);
            break; // restart the selector loop after each click
          }
        } catch {
          // selector not found or not visible — try next
        }
      }

      if (!clicked) {
        log(
          totalClicks > 0
            ? `No more "show more" buttons found after ${totalClicks} click(s).`
            : "No 'show more' buttons found on page."
        );
        break;
      }
    }

    if (totalClicks >= MAX_CLICKS) {
      log(`Reached maximum click limit (${MAX_CLICKS}).`);
    }

    // --- Extract fully-rendered HTML ---
    log("Extracting fully-rendered page content...");
    const html = await page.content();

    // --- Parse with cheerio ---
    log("Parsing rendered HTML...");
    const result = parseRenderedHtml(html, url);

    log(
      `Done. Found ${result.images.length} images, ${result.links.length} links.`
    );
    return result;
  } finally {
    await browser.close();
  }
}
