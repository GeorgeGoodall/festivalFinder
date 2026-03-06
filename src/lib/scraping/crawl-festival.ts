import { scrapeUrl, normalizeUrl } from "./scrape-url";
import type { LinkWithContext, ImageCandidate } from "./scrape-url";
import { filterLinksForFestival } from "@/lib/ai/filter-links";
import { classifyPage, type PageCategory } from "@/lib/ai/classify-page";
import { extractFestivalFromText } from "@/lib/ai/extract-festival";
import { extractFromPoster, type ExtractionResult } from "@/lib/extraction";
import { CrawlUsageTracker, type UsageSummary } from "./scrape-usage";
import { supabaseAdmin } from "@/lib/supabase";

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
  const posterImages: ImageCandidate[] = [];
  let discoveredLineupUrl: string | null = null;
  let discoveredPosterPageUrl: string | null = null;

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

  // Collect images from homepage
  posterImages.push(...homepage.images);

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

      // Always collect images from any page
      posterImages.push(...page.images);

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
  } else if (posterImages.length > 0) {
    emit({
      stage: "poster_fallback",
      message: "No HTML lineup found. Extracting from poster image...",
      usage: tracker.getSummary(),
    });

    const posterResult = await extractFromPoster(posterImages[0].src);
    tracker.addExtraction(posterResult.usage);
    extraction = posterResult.extraction;
    source = "poster";
  } else {
    throw new Error(
      "Could not find any lineup, festival info, or poster images"
    );
  }

  // -----------------------------------------------------------------------
  // 5. Poster storage
  // -----------------------------------------------------------------------

  let posterImageUrl: string | null =
    posterImages.length > 0 ? posterImages[0].src : null;

  if (posterImages.length > 0) {
    try {
      const bestImage = posterImages[0];
      const imgResponse = await fetch(bestImage.src);
      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
      const ext = getExtensionFromUrl(bestImage.src);
      const filename = `posters/${Date.now()}-crawled${ext}`;

      const contentType =
        imgResponse.headers.get("content-type") || "image/jpeg";

      const { error } = await supabaseAdmin.storage
        .from("festival-posters")
        .upload(filename, imgBuffer, {
          contentType,
          upsert: false,
        });

      if (!error) {
        const {
          data: { publicUrl },
        } = supabaseAdmin.storage
          .from("festival-posters")
          .getPublicUrl(filename);
        posterImageUrl = publicUrl;
      }
    } catch {
      // Non-fatal: keep external URL
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
    usage,
    pageTree: rootNode,
    pagesScraped: totalScraped,
  };
}
