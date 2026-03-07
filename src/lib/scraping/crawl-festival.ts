import { scrapeUrl, normalizeUrl } from "./scrape-url";
import type { LinkWithContext, ImageCandidate as ScrapeImageCandidate } from "./scrape-url";
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
  img: ScrapeImageCandidate;
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
  | "logo"
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

export interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
}

export interface CrawlResult {
  extraction: ExtractionResult;
  source: "text" | "poster" | "text+poster";
  lineupUrl: string | null;
  posterPageUrl: string | null;
  imageCandidates: ImageCandidate[];
  algorithmPosterSrc: string | null;
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
  if (contentType.includes("x-icon") || contentType.includes("vnd.microsoft.icon")) return ".ico";
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

    console.log(`[crawl] Filter selected ${filterResult.selected.length}/${sameDomainLinks.length} links: ${filterResult.selected.map(l => urlPathname(l.url)).join(", ")}`);

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
      } catch (err) {
        console.warn(`[crawl] Failed to fetch "${link.url}":`, err);
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

      // URL-based heuristics — override or supplement AI classification
      const pagePath = urlPathname(page.url);
      const isPosterUrl = /poster|artwork|flyer|download|press|media/i.test(pagePath);
      const isLineupUrl = /lineup|artists?|performers?|acts|headliners?|bill|programme|program|schedule|stages?/i.test(pagePath);

      // Handle based on category (URL heuristics take priority for lineup/poster)
      const effectiveLineup = classification.category === "lineup" || isLineupUrl;
      const effectivePoster = classification.category === "poster_only" || isPosterUrl;

      if (effectiveLineup) {
        lineupContent.push({ url: page.url, text: page.text });
        if (!discoveredLineupUrl) {
          discoveredLineupUrl = page.url;
        }
      } else if (effectivePoster) {
        if (!discoveredPosterPageUrl) {
          discoveredPosterPageUrl = page.url;
        }
      } else if (classification.category === "info") {
        infoContent.push({ url: page.url, text: page.text });
      }

      // Route images to priority buckets
      const nonOgImages = page.images.filter(i => i.alt !== "og:image");
      const ogImgs = page.images.filter(i => i.alt === "og:image");

      for (const img of ogImgs) {
        if (!ogImage) ogImage = { img, sourcePage: page.url, sourceClassification: "og" };
      }

      for (const img of nonOgImages) {
        if (effectivePoster) {
          posterPageImages.push({ img, sourcePage: page.url, sourceClassification: "poster_only" });
        } else if (effectiveLineup) {
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
  let source: "text" | "poster" | "text+poster";

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

    // Check if any single lineup page is a rich lineup page (20+ artists).
    // We do this by counting how many of the extracted artist names appear in
    // each page's raw text — free, no extra AI calls needed.
    const artistNames = extraction.artists.map((a) => a.name.toLowerCase());
    let maxArtistsOnSinglePage = 0;
    for (const page of lineupContent) {
      const pageText = page.text.toLowerCase();
      const count = artistNames.filter((name) => pageText.includes(name)).length;
      if (count > maxArtistsOnSinglePage) maxArtistsOnSinglePage = count;
    }

    const hasRichLineupPage = maxArtistsOnSinglePage >= 20;

    if (hasRichLineupPage) {
      emit({
        stage: "extracting",
        message: `Artist page found (${maxArtistsOnSinglePage} artists on one page) — not scanning poster`,
        usage: tracker.getSummary(),
      });
    } else if (!extraction.lineup_pending && bestCandidateForExtraction) {
      emit({
        stage: "extracting",
        message: `No artist page found (max ${maxArtistsOnSinglePage} artists on any one page) — scanning poster`,
        usage: tracker.getSummary(),
      });

      const posterResult = await extractFromPoster(bestCandidateForExtraction.img.src);
      tracker.addExtraction(posterResult.usage);

      // Merge poster artists into text extraction, deduplicating by name
      const existingNames = new Set(extraction.artists.map((a) => a.name.toLowerCase()));
      const newArtists = posterResult.extraction.artists.filter(
        (a) => !existingNames.has(a.name.toLowerCase())
      );

      if (newArtists.length > 0) {
        extraction = { ...extraction, artists: [...extraction.artists, ...newArtists] };
        source = "text+poster";
        emit({
          stage: "extracting",
          message: `Poster added ${newArtists.length} additional artist(s) — total: ${extraction.artists.length}`,
          usage: tracker.getSummary(),
        });
      } else {
        emit({
          stage: "extracting",
          message: "Poster scan complete — no additional artists found",
          usage: tracker.getSummary(),
        });
      }
    } else if (!extraction.lineup_pending) {
      emit({
        stage: "extracting",
        message: `No artist page found (max ${maxArtistsOnSinglePage} artists on any one page) — no poster available to scan`,
        usage: tracker.getSummary(),
      });
    }
  } else if (bestCandidateForExtraction) {
    emit({
      stage: "poster_fallback",
      message: "No HTML content found. Extracting from poster image...",
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
  // 5. Build flat imageCandidates list from all buckets
  // -----------------------------------------------------------------------

  const imageCandidates: ImageCandidate[] = [
    ...posterPageImages.map((c) => ({
      src: c.img.src,
      alt: c.img.alt,
      sourcePage: c.sourcePage,
      sourceClassification: "poster_only" as const,
      width: c.img.width,
      height: c.img.height,
    })),
    ...lineupImages.map((c) => ({
      src: c.img.src,
      alt: c.img.alt,
      sourcePage: c.sourcePage,
      sourceClassification: "lineup" as const,
      width: c.img.width,
      height: c.img.height,
    })),
    ...fallbackImages.map((c) => ({
      src: c.img.src,
      alt: c.img.alt,
      sourcePage: c.sourcePage,
      sourceClassification: "fallback" as const,
      width: c.img.width,
      height: c.img.height,
    })),
    ...(ogImage
      ? [{
          src: ogImage.img.src,
          alt: ogImage.img.alt,
          sourcePage: ogImage.sourcePage,
          sourceClassification: "og" as const,
          width: ogImage.img.width,
          height: ogImage.img.height,
        }]
      : []),
  ];

  // Add favicon as a candidate if present
  if (homepage.faviconUrl) {
    imageCandidates.push({
      src: homepage.faviconUrl,
      alt: "favicon",
      sourcePage: homepage.url,
      sourceClassification: "favicon",
      width: null,
      height: null,
    });
  }

  // -----------------------------------------------------------------------
  // 5b. Algorithm poster pick — choose best candidate without fetching.
  //     Prefer images with known large dimensions or no dimension info.
  //     Priority order is already encoded in imageCandidates order.
  // -----------------------------------------------------------------------

  const MIN_DIM = 800;
  let algorithmPosterSrc: string | null = null;

  for (const candidate of imageCandidates) {
    if (candidate.sourceClassification === "favicon") continue;

    const w = candidate.width ?? 0;
    const h = candidate.height ?? 0;
    const hasDimensions = candidate.width !== null || candidate.height !== null;

    // Skip if dimensions are known and too small
    if (hasDimensions && (w < MIN_DIM || h < MIN_DIM)) continue;

    algorithmPosterSrc = candidate.src;
    break;
  }

  // -----------------------------------------------------------------------
  // Logo extraction — always attempt, regardless of lineupPending
  // -----------------------------------------------------------------------

  if (homepage.faviconUrl) {
    emit({
      stage: "logo",
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
        clearTimeout(logoTimeout);
      } catch (err) {
        clearTimeout(logoTimeout);
        throw err;
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
              stage: "logo",
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
    imageCandidates,
    algorithmPosterSrc,
    lineupPending,
    logoImageUrl,
    usage,
    pageTree: rootNode,
    pagesScraped: totalScraped,
  };
}
