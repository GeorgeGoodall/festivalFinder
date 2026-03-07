import * as cheerio from "cheerio";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; FestivalFinder/1.0; +https://festivalfinder.uk)";

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

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface LinkWithContext {
  url: string;
  text: string;
  /** ~200 chars of surrounding text for context */
  context: string;
}

export interface ImageCandidate {
  src: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface ScrapeResult {
  url: string;
  text: string;
  jsonLd: string | null;
  links: LinkWithContext[];
  images: ImageCandidate[];
  title: string;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a URL: strip fragments, add trailing slash if no file extension.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // Add trailing slash if the pathname has no file extension
    const lastSegment = u.pathname.split("/").pop() ?? "";
    const hasExtension = lastSegment.includes(".");
    if (!hasExtension && !u.pathname.endsWith("/")) {
      u.pathname += "/";
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * SHA-256 hash of the given text for change detection.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Internal helpers
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
  // Walk up to find a block-level parent with meaningful text
  const parent = $el.closest("p, li, div, td, section, article");
  const raw = (parent.length ? parent : $el).text().replace(/\s+/g, " ").trim();
  if (raw.length <= 200) return raw;
  // Centre around the link text
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
// Main scrape function
// ---------------------------------------------------------------------------

/**
 * Fetch the given URL, parse the HTML, and return cleaned text, links, images,
 * JSON-LD, and page title.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${res.status} ${res.statusText}`
      );
    }
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

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
        images.push({ src: resolved, alt: "og:image", width: null, height: null });
      }
    } catch {
      // skip invalid og:image
    }
  }

  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;

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

  return { url, text, jsonLd, links, images, title };
}
