import { imageSize } from "image-size";
import { scrapeUrl, normalizeUrl } from "./scrape-url";
import type { LinkWithContext, ImageCandidate } from "./scrape-url";
import { filterLinksForFestival } from "@/lib/ai/filter-links";
import { classifyPage, type PageCategory } from "@/lib/ai/classify-page";
import { extractFestivalFromText } from "@/lib/ai/extract-festival";
import { extractFromPoster, type ExtractionResult } from "@/lib/extraction";
import { CrawlUsageTracker, type UsageSummary } from "./scrape-usage";
import { supabaseAdmin } from "@/lib/supabase";
import { inferRegionFromLocation } from "@/lib/ai/infer-region";
import { UK_REGIONS } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Internal image bucket type
// ---------------------------------------------------------------------------

interface PosterCandidate {
  img: ImageCandidate;
  sourcePage: string;
  sourceClassification: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DEPTH = 3;
const MAX_PAGES = 10;
const MAX_AI_CALLS = 20;

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type CrawlStage =
  | "fetching"
  | "filtering"
  | "crawling"
  | "classifying"
  | "extracting"
  | "poster_search"
  | "poster_fallback"
  | "complete"
  | "error";

export interface CrawlProgress {
  stage: CrawlStage;
  message: string;
  pageTree: PageNode[];
  currentPage?: number;
  totalPages?: number;
  usage?: UsageSummary;
}

export interface PageNode {
  url: string;
  title: string;
  category: PageCategory | "pending";
  children: PageNode[];
}

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

interface CrawlOptions {
  onProgress?: (progress: CrawlProgress) => void;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface QueueEntry {
  links: LinkWithContext[];
  depth: number;
  parentUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function urlPathname(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

function isAllowedUrl(url: string, startDomain: string): boolean {
  try {
    return new URL(url).hostname === startDomain;
  } catch {
    return false;
  }
}

function getExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").pop() ?? "";
    const dotIdx = lastSegment.lastIndexOf(".");
    if (dotIdx !== -1) return lastSegment.slice(dotIdx);
  } catch {
    // ignore
  }
  return ".jpg";
}

function contentTypeToExt(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  return ".png";
}

// ---------------------------------------------------------------------------
// Main crawl function
// ---------------------------------------------------------------------------

export async function crawlFestival(
  startUrl: string,
  options?: CrawlOptions
): Promise<CrawlResult> {
  const { onProgress, signal } = options ?? {};
  const tracker = new CrawlUsageTracker();
  const visitedUrls = new Set<string>();
  const pageNodes = new Map<string, PageNode>();

  let totalScraped = 0;
  let totalAiCalls = 0;

  // Content collectors
  const lineupContent: { url: string; text: string }[] = [];
  const infoContent: { url: string; text: string }[] = [];
  const posterPageImages: PosterCandidate[] = [];   // from poster_only pages (best)
  const lineupImages: PosterCandidate[] = [];        // from lineup pages
  const fallbackImages: PosterCandidate[] = [];      // <img> elements from homepage + info/other pages
  let ogImage: PosterCandidate | null = null;        // og:image fallback (worst)
  let discoveredLineupUrl: string | null = null;
  let discoveredPosterPageUrl: string | null = null;
  let lineupPending = false;
  let logoImageUrl: string | null = null;

  const startDomain = new URL(startUrl).hostname;

  // Build root node
  const rootNode: PageNode = {
    url: startUrl,
    title: "",
    category: "pending",
    children: [],
  };
  pageNodes.set(normalizeUrl(startUrl), rootNode);

  function emit(progress: Omit<CrawlProgress, "pageTree">) {
    onProgress?.({ ...progress, pageTree: [rootNode] });
  }

  // -----------------------------------------------------------------------
  // 1. Fetch homepage
  // -----------------------------------------------------------------------

  emit({ stage: "fetching", message: "Fetching homepage..." });

  if (signal?.aborted) throw new Error("Crawl aborted");

  const homepage = await scrapeUrl(startUrl);
  visitedUrls.add(normalizeUrl(startUrl));
  totalScraped++;

  rootNode.title = homepage.title;

  // Homepage usually has festival details
  infoContent.push({ url: homepage.url, text: homepage.text });

  // Collect images from homepage — split og:image from real <img> elements
  const homepagePath = urlPathname(homepage.url);
  for (const img of homepage.images) {
    if (img.alt === "og:image") {
      if (!ogImage) ogImage = { img, sourcePage: homepage.url, sourceClassification: "og" };
    } else {
      fallbackImages.push({ img, sourcePage: homepage.url, sourceClassification: "fallback" });
    }
  }
  console.log(`[poster] Homepage (${homepagePath}): ${homepage.images.filter(i => i.alt !== "og:image").length} image(s) collected`);

  // -----------------------------------------------------------------------
  // 2. Seed BFS queue
  // -----------------------------------------------------------------------

  const queue: QueueEntry[] = [];
  if (homepage.links.length > 0) {
    queue.push({
      links: homepage.links,
      depth: 0,
      parentUrl: normalizeUrl(startUrl),
    });
  }

  // -----------------------------------------------------------------------
  // 3. BFS loop
  // -----------------------------------------------------------------------

  while (
    queue.length > 0 &&
    totalScraped < MAX_PAGES &&
    totalAiCalls < MAX_AI_CALLS &&
    !signal?.aborted
  ) {
    const entry = queue.shift()!;
    const { links, depth, parentUrl } = entry;

    // Filter to same-domain links only
    const sameDomainLinks = links.filter((l) =>
      isAllowedUrl(l.url, startDomain)
    );

    if (sameDomainLinks.length === 0) continue;

    // Filter links with AI
    emit({
      stage: "filtering",
      message: `Analyzing ${sameDomainLinks.length} links...`,
      usage: tracker.getSummary(),
    });

    const filterResult = await filterLinksForFestival(sameDomainLinks);
    tracker.addFilterLinks(filterResult.usage);
    totalAiCalls++;

    if (signal?.aborted) break;

    // Process each selected link
    for (const link of filterResult.selected) {
      if (totalScraped >= MAX_PAGES || totalAiCalls >= MAX_AI_CALLS) break;
      if (signal?.aborted) break;

      const normUrl = normalizeUrl(link.url);
      if (visitedUrls.has(normUrl)) continue;
      visitedUrls.add(normUrl);

      // Emit crawling progress
      totalScraped++;
      emit({
        stage: "crawling",
        message: `Fetching: ${link.text || "page"} (page ${totalScraped}/${MAX_PAGES})`,
        currentPage: totalScraped,
        totalPages: MAX_PAGES,
        usage: tracker.getSummary(),
      });

      // Fetch the page
      let page;
      try {
        page = await scrapeUrl(link.url);
      } catch {
        // Continue on fetch failure
        continue;
      }

      // Classify the page
      const classification = await classifyPage(
        page.text,
        page.jsonLd,
        page.images.length > 0
      );
      tracker.addClassifyPage(classification.usage);
      totalAiCalls++;

      // Build page node and add to tree
      const pageNode: PageNode = {
        url: link.url,
        title: page.title || link.text,
        category: classification.category,
        children: [],
      };
      pageNodes.set(normUrl, pageNode);

      // Add as child of parent
      const parentNode = pageNodes.get(parentUrl);
      if (parentNode) {
        parentNode.children.push(pageNode);
      }

      emit({
        stage: "classifying",
        message: `${link.text || page.title}: ${classification.category} (${Math.round(classification.confidence * 100)}%)`,
        usage: tracker.getSummary(),
      });

      // Handle based on category
      switch (classification.category) {
        case "lineup":
          lineupContent.push({ url: page.url, text: page.text });
          if (!discoveredLineupUrl) {
            discoveredLineupUrl = page.url;
          }
          break;
        case "info":
          infoContent.push({ url: page.url, text: page.text });
          break;
        case "poster_only":
          if (!discoveredPosterPageUrl) {
            discoveredPosterPageUrl = page.url;
          }
          break;
      }

      // Route images to priority buckets based on page classification
      const pagePath = urlPathname(page.url);
      const nonOgImages = page.images.filter(i => i.alt !== "og:image");
      const ogImgs = page.images.filter(i => i.alt === "og:image");

      for (const img of ogImgs) {
        if (!ogImage) ogImage = { img, sourcePage: page.url, sourceClassification: "og" };
      }

      for (const img of nonOgImages) {
        if (classification.category === "poster_only") {
          posterPageImages.push({ img, sourcePage: page.url, sourceClassification: "poster_only" });
        } else if (classification.category === "lineup") {
          lineupImages.push({ img, sourcePage: page.url, sourceClassification: "lineup" });
        } else {
          fallbackImages.push({ img, sourcePage: page.url, sourceClassification: "fallback" });
        }
      }

      if (nonOgImages.length > 0) {
        console.log(`[poster] Page "${pagePath}" (${classification.category}): ${nonOgImages.length} image(s) — ${nonOgImages.map(i => i.src).join(", ")}`);
      }

      // Enqueue child links if within depth limit
      if (depth + 1 < MAX_DEPTH && page.links.length > 0) {
        queue.push({
          links: page.links,
          depth: depth + 1,
          parentUrl: normUrl,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Final extraction
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // 4b. Infer region from location if needed
  // -----------------------------------------------------------------------

  if (
    extraction.location &&
    (!extraction.region ||
      !(UK_REGIONS as readonly string[]).includes(extraction.region))
  ) {
    emit({
      stage: "extracting",
      message: "Inferring UK region from location...",
      usage: tracker.getSummary(),
    });

    try {
      const regionResult = await inferRegionFromLocation(extraction.location);
      tracker.addInferRegion(regionResult.usage);
      if (regionResult.region) {
        extraction.region = regionResult.region;
      }
    } catch (err) {
      console.error("[crawlFestival] inferRegion failed:", err);
    }
  }

  // -----------------------------------------------------------------------
  // 5. Poster storage — iterate candidates in priority order, pick first
  //    that passes size (≥50KB) and dimension (≥400×400px) checks.
  //    Fetches are serial to minimise bandwidth — stops at the first image
  //    that passes quality checks.
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

    console.log(`[poster] ${allCandidates.length} total candidate(s) across all buckets`);
    emit({
      stage: "poster_search",
      message: `Searching for poster — ${allCandidates.length} candidate image(s) found`,
      usage: tracker.getSummary(),
    });

    for (const candidate of allCandidates) {
      const src = candidate.img.src;
      const srcPath = urlPathname(src);
      const pagePathLabel = urlPathname(candidate.sourcePage);

      console.log(`[poster] Checking "${srcPath}" from ${pagePathLabel} (${candidate.sourceClassification})`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      let imgResponse: Response;
      try {
        imgResponse = await fetch(src, { signal: controller.signal });
      } catch (err) {
        console.warn(`[poster] Skipping "${srcPath}": fetch failed —`, err);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      const contentType = imgResponse.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        console.warn(`[poster] Skipping "${srcPath}": non-image content-type "${contentType}"`);
        continue;
      }

      const contentLength = Number(imgResponse.headers.get("content-length") ?? 0);
      if (contentLength > 0 && contentLength < MIN_BYTES) {
        console.log(`[poster] Skipping "${srcPath}": content-length too small (${Math.round(contentLength / 1024)}KB < 50KB)`);
        continue;
      }

      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

      if (imgBuffer.length < MIN_BYTES) {
        console.log(`[poster] Skipping "${srcPath}": too small (${Math.round(imgBuffer.length / 1024)}KB < 50KB)`);
        continue;
      }

      let dims: { width?: number; height?: number } = {};
      try {
        dims = imageSize(imgBuffer);
      } catch {
        console.warn(`[poster] Could not read dimensions for "${srcPath}", skipping`);
        continue;
      }

      const w = dims.width ?? 0;
      const h = dims.height ?? 0;
      if (w < MIN_DIM || h < MIN_DIM) {
        console.log(`[poster] Skipping "${srcPath}": dimensions too small (${w}×${h} < ${MIN_DIM}×${MIN_DIM})`);
        continue;
      }

      console.log(`[poster] Selected "${srcPath}" (${Math.round(imgBuffer.length / 1024)}KB, ${w}×${h}) from ${pagePathLabel}`);
      emit({
        stage: "poster_search",
        message: `Selected poster from ${pagePathLabel} (${Math.round(imgBuffer.length / 1024)}KB, ${w}×${h}px)`,
        usage: tracker.getSummary(),
      });

      const ext = getExtensionFromUrl(src);
      const filename = `crawled-${Date.now()}${ext}`;

      const { error } = await supabaseAdmin.storage
        .from("posters")
        .upload(filename, imgBuffer, { contentType, upsert: false });

      if (!error) {
        const { data: { publicUrl } } = supabaseAdmin.storage
          .from("posters")
          .getPublicUrl(filename);
        posterImageUrl = publicUrl;
      } else {
        console.error("[poster] Supabase upload failed:", error);
      }

      break;
    }

    if (!posterImageUrl && allCandidates.length > 0) {
      posterImageUrl = allCandidates[0].img.src;
      console.warn("[poster] No candidate passed quality checks — using external URL as fallback:", posterImageUrl);
      emit({
        stage: "poster_search",
        message: "No suitable poster image found — using external URL as fallback",
        usage: tracker.getSummary(),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Logo extraction — always attempt, regardless of lineupPending
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
        const MIN_LOGO_BYTES = 2 * 1024; // 2KB — skip 1x1 tracking pixels
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

  // -----------------------------------------------------------------------
  // 6. Return result
  // -----------------------------------------------------------------------

  const usage = tracker.getSummary();

  emit({
    stage: "complete",
    message: `Done. Scraped ${totalScraped} page(s), found ${extraction.artists.length} artists.`,
    usage,
  });

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
}
