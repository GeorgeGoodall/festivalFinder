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
import { scorePosterCandidates, isUnambiguousWinner } from "./score-poster-candidates";
import { selectPosterWithGemini } from "@/lib/ai/providers/gemini/select-poster";
import type { ImageForDisambiguation } from "@/lib/ai/providers/gemini/select-poster";

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
const MAX_POSTER_ATTEMPTS = 3;
const GEMINI_DISAMBIGUATION_TOP_N = 5;

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
  /** Nearby heading, parent class/id, figcaption — captured during scraping */
  surroundingContext: string;
}

export interface DeepScrapeCandidate {
  url: string;
  reason: string;
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
  deepScrapeCandidate: DeepScrapeCandidate | null;
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
  const aboutContent: { url: string; text: string }[] = [];
  const posterPageImages: PosterCandidate[] = [];   // from poster_only pages (best)
  const lineupImages: PosterCandidate[] = [];        // from lineup pages
  const fallbackImages: PosterCandidate[] = [];      // <img> elements from homepage + info/other pages
  let ogImage: PosterCandidate | null = null;        // og:image fallback (worst)
  let discoveredLineupUrl: string | null = null;
  let discoveredPosterPageUrl: string | null = null;
  let lineupPending = false;
  let logoImageUrl: string | null = null;
  let deepScrapeCandidate: DeepScrapeCandidate | null = null;

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
        if ((page.hasShowMore || page.isJsRendered) && !deepScrapeCandidate) {
          const reason = page.isJsRendered
            ? "Artist page is built with a JS-rendering platform (Wix/Squarespace/Webflow) — artists may not load in static HTML."
            : "Artist page has a \"Show More\" button — content may be hidden behind JavaScript.";
          deepScrapeCandidate = { url: page.url, reason };
          emit({
            stage: "classifying",
            message: page.isJsRendered
              ? `Detected JS-rendered platform on artist page — deep scrape recommended`
              : `Detected "Show More" on artist page — deep scrape recommended`,
            usage: tracker.getSummary(),
          });
        }
      } else if (effectivePoster) {
        if (!discoveredPosterPageUrl) {
          discoveredPosterPageUrl = page.url;
        }
      } else if (classification.category === "about") {
        aboutContent.push({ url: page.url, text: page.text });
        console.log(`[crawl] Routed "about" page: ${urlPathname(page.url)}`);
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
  // 4. Text extraction
  // -----------------------------------------------------------------------

  let extraction: ExtractionResult;
  let source: "text" | "poster" | "text+poster";
  let hasRichLineupPage = false;
  let maxArtistsOnSinglePage = 0;
  const hasTextContent = lineupContent.length > 0 || infoContent.length > 0;

  if (hasTextContent) {
    emit({
      stage: "extracting",
      message: `Extracting festival details from ${lineupContent.length + infoContent.length + aboutContent.length} page(s)...`,
      usage: tracker.getSummary(),
    });

    const textResult = await extractFestivalFromText(
      lineupContent,
      infoContent,
      startUrl,
      aboutContent,
    );
    tracker.addExtraction(textResult.usage);
    extraction = textResult.extraction;
    source = "text";

    // Check if any single lineup page is a rich lineup page (20+ artists).
    // We do this by counting how many of the extracted artist names appear in
    // each page's raw text — free, no extra AI calls needed.
    const artistNames = extraction.artists.map((a) => a.name.toLowerCase());
    for (const page of lineupContent) {
      const pageText = page.text.toLowerCase();
      const count = artistNames.filter((name) => pageText.includes(name)).length;
      if (count > maxArtistsOnSinglePage) maxArtistsOnSinglePage = count;
    }

    hasRichLineupPage = maxArtistsOnSinglePage >= 20;

    if (hasRichLineupPage) {
      emit({
        stage: "extracting",
        message: `Artist page found (${maxArtistsOnSinglePage} artists on one page) — not scanning poster`,
        usage: tracker.getSummary(),
      });
    }
  } else {
    // Placeholder — will be set in the poster extraction section below
    extraction = null as unknown as ExtractionResult;
    source = "poster";
  }

  lineupPending = extraction?.lineup_pending ?? false;

  if (lineupPending) {
    emit({
      stage: "extracting",
      message: "Lineup not yet announced — skipping poster search.",
      usage: tracker.getSummary(),
    });
  }

  // If AI flagged the lineup may be incomplete and cheerio didn't already detect
  // a "Show More" button, set deepScrapeCandidate using the discovered lineup URL.
  if (extraction?.lineup_may_be_incomplete && !deepScrapeCandidate && discoveredLineupUrl) {
    deepScrapeCandidate = {
      url: discoveredLineupUrl,
      reason: "AI detected signals that the artist list may be incomplete (e.g. lazy-loading or pagination). Deep scrape recommended.",
    };
    emit({
      stage: "extracting",
      message: "AI detected incomplete lineup — deep scrape recommended",
      usage: tracker.getSummary(),
    });
  }

  // -----------------------------------------------------------------------
  // 4b. Infer region from location if needed
  // -----------------------------------------------------------------------

  if (
    extraction?.location &&
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
      surroundingContext: c.img.surroundingContext,
    })),
    ...lineupImages.map((c) => ({
      src: c.img.src,
      alt: c.img.alt,
      sourcePage: c.sourcePage,
      sourceClassification: "lineup" as const,
      width: c.img.width,
      height: c.img.height,
      surroundingContext: c.img.surroundingContext,
    })),
    ...fallbackImages.map((c) => ({
      src: c.img.src,
      alt: c.img.alt,
      sourcePage: c.sourcePage,
      sourceClassification: "fallback" as const,
      width: c.img.width,
      height: c.img.height,
      surroundingContext: c.img.surroundingContext,
    })),
    ...(ogImage
      ? [{
          src: ogImage.img.src,
          alt: ogImage.img.alt,
          sourcePage: ogImage.sourcePage,
          sourceClassification: "og" as const,
          width: ogImage.img.width,
          height: ogImage.img.height,
          surroundingContext: "",   // og:image has no DOM context
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
      surroundingContext: "",   // favicon has no DOM context
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
  // 5c. Poster extraction — scoring, disambiguation, retry loop
  //     Runs AFTER imageCandidates is built so scoring has full context.
  // -----------------------------------------------------------------------

  if (hasTextContent) {
    if (hasRichLineupPage) {
      // Already emitted message above — skip poster scan
    } else if (!extraction.lineup_pending) {
      // -----------------------------------------------------------------------
      // Score and rank image candidates
      // -----------------------------------------------------------------------

      const scored = scorePosterCandidates(imageCandidates);

      console.log(`[poster-score] Scored ${scored.length} candidate(s):`);
      for (const sc of scored.slice(0, 8)) {
        console.log(
          `  [${sc.score.toString().padStart(3)}] ${sc.candidate.src}` +
          `\n         breakdown: source=${sc.breakdown.source} url=${sc.breakdown.urlKeyword}` +
          ` year=${sc.breakdown.year} alt=${sc.breakdown.altKeyword}` +
          ` ctx=${sc.breakdown.contextKeyword} ratio=${sc.breakdown.aspectRatio}` +
          ` dims=${sc.breakdown.dimensions}`
        );
      }

      if (scored.length === 0) {
        emit({
          stage: "extracting",
          message: "No poster candidates found — skipping poster scan",
          usage: tracker.getSummary(),
        });
      } else {
        // -----------------------------------------------------------------------
        // Disambiguation: if ambiguous, ask Gemini to pick
        // -----------------------------------------------------------------------

        let rankedCandidates = scored;
        const unambiguous = isUnambiguousWinner(scored);

        if (unambiguous) {
          emit({
            stage: "poster_search",
            message: `Clear poster candidate (score: ${scored[0].score}) — ${(() => { try { return new URL(scored[0].candidate.src).pathname; } catch { return scored[0].candidate.src; } })()}`,
            usage: tracker.getSummary(),
          });
          console.log(`[poster-score] Unambiguous winner (score ${scored[0].score}, gap ${scored[0].score - (scored[1]?.score ?? 0)})`);
        } else {
          const topN = scored.slice(0, GEMINI_DISAMBIGUATION_TOP_N);
          emit({
            stage: "poster_search",
            message: `Scores ambiguous — asking Gemini to pick best poster from top ${topN.length} candidate(s)`,
            usage: tracker.getSummary(),
          });
          console.log(`[poster-select] Ambiguous — fetching top ${topN.length} images for Gemini disambiguation`);

          try {
            const imagesForGemini: ImageForDisambiguation[] = [];
            for (const sc of topN) {
              try {
                const controller = new AbortController();
                const t = setTimeout(() => controller.abort(), 10_000);
                const res = await fetch(sc.candidate.src, { signal: controller.signal });
                clearTimeout(t);
                if (!res.ok) continue;
                const rawCt = res.headers.get("content-type") || "image/jpeg";
                const ct = rawCt.split(";")[0].trim(); // strip MIME parameters
                if (!ct.startsWith("image/")) continue;
                const buf = Buffer.from(await res.arrayBuffer());
                imagesForGemini.push({
                  base64: buf.toString("base64"),
                  contentType: ct,
                  src: sc.candidate.src,
                });
              } catch (fetchErr) {
                console.warn(`[poster-select] Failed to fetch candidate for disambiguation: ${sc.candidate.src}`, fetchErr);
              }
            }

            if (imagesForGemini.length > 0) {
              const selectResult = await selectPosterWithGemini(imagesForGemini);
              // TODO Task 7: tracker.addSelectPoster(selectResult.usage);

              // Reorder: put Gemini's pick first, keep rest in score order
              const winningSrc = imagesForGemini[selectResult.selectedIndex].src;
              const winner = scored.find((s) => s.candidate.src === winningSrc);
              const rest = scored.filter((s) => s.candidate.src !== winningSrc);
              if (winner) {
                rankedCandidates = [winner, ...rest];
                emit({
                  stage: "poster_search",
                  message: `Gemini selected: ${(() => { try { return new URL(winningSrc).pathname; } catch { return winningSrc; } })()}`,
                  usage: tracker.getSummary(),
                });
                console.log(`[poster-select] Gemini winner: ${winningSrc}`);
              }
            } else {
              emit({
                stage: "poster_search",
                message: "Could not fetch candidates for disambiguation — using score order",
                usage: tracker.getSummary(),
              });
            }
          } catch (disambigErr) {
            console.warn("[poster-select] Gemini disambiguation failed — falling back to score order:", disambigErr);
            emit({
              stage: "poster_search",
              message: "Poster disambiguation failed — using score order",
              usage: tracker.getSummary(),
            });
          }
        }

        // -----------------------------------------------------------------------
        // Retry loop: try extraction on ranked candidates, up to MAX_POSTER_ATTEMPTS
        // -----------------------------------------------------------------------

        let posterExtractionSucceeded = false;
        let attemptCount = 0;

        for (const sc of rankedCandidates) {
          if (attemptCount >= MAX_POSTER_ATTEMPTS) break;
          if (signal?.aborted) break;

          attemptCount++;
          const candidatePath = (() => { try { return new URL(sc.candidate.src).pathname; } catch { return sc.candidate.src; } })();

          emit({
            stage: "extracting",
            message: `Scanning poster (attempt ${attemptCount}/${MAX_POSTER_ATTEMPTS}): ${candidatePath}`,
            usage: tracker.getSummary(),
          });
          console.log(`[poster-extract] Attempt ${attemptCount}/${MAX_POSTER_ATTEMPTS}: ${sc.candidate.src} (score: ${sc.score})`);

          try {
            const posterResult = await extractFromPoster(sc.candidate.src);
            tracker.addExtraction(posterResult.usage);

            if (posterResult.extraction.is_lineup_poster === false) {
              console.log(`[poster-extract] Not a lineup poster — skipping to next candidate`);
              emit({
                stage: "extracting",
                message: `Image was not a lineup poster — trying next candidate`,
                usage: tracker.getSummary(),
              });
              continue;
            }

            // Success — merge artists
            posterExtractionSucceeded = true;
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
            break;
          } catch (extractErr) {
            console.warn(`[poster-extract] Extraction failed for ${sc.candidate.src}:`, extractErr);
            emit({
              stage: "extracting",
              message: `Poster extraction failed — trying next candidate`,
              usage: tracker.getSummary(),
            });
          }
        }

        // -----------------------------------------------------------------------
        // All attempts exhausted without a lineup poster — flag for admin review
        // -----------------------------------------------------------------------

        if (!posterExtractionSucceeded && attemptCount >= MAX_POSTER_ATTEMPTS) {
          console.log(`[poster-extract] ${MAX_POSTER_ATTEMPTS} attempts all returned non-poster images — assuming lineup not yet available`);
          extraction = { ...extraction, lineup_pending: true };
          lineupPending = true;
          if (!deepScrapeCandidate) {
            deepScrapeCandidate = {
              url: discoveredLineupUrl ?? startUrl,
              reason: `No lineup poster found after ${MAX_POSTER_ATTEMPTS} extraction attempt(s) — lineup may not yet be announced. Admin review recommended.`,
            };
          }
          emit({
            stage: "extracting",
            message: `No lineup poster found after ${MAX_POSTER_ATTEMPTS} attempt(s) — flagged for admin review`,
            usage: tracker.getSummary(),
          });
        }
      }
    }
  } else {
    const scored = scorePosterCandidates(imageCandidates);
    console.log(`[poster-score] Fallback path — ${scored.length} candidate(s) scored`);
    for (const sc of scored.slice(0, 5)) {
      console.log(`  [${sc.score}] ${sc.candidate.src}`);
    }

    if (scored.length === 0) {
      throw new Error("Could not find any lineup, festival info, or poster images");
    }

    emit({
      stage: "poster_fallback",
      message: "No HTML content found. Extracting from best scored poster image...",
      usage: tracker.getSummary(),
    });

    let fallbackSucceeded = false;
    for (const sc of scored.slice(0, MAX_POSTER_ATTEMPTS)) {
      try {
        const posterResult = await extractFromPoster(sc.candidate.src);
        tracker.addExtraction(posterResult.usage);
        if (posterResult.extraction.is_lineup_poster === false) {
          console.log(`[poster-extract] Fallback: not a lineup poster — trying next`);
          continue;
        }
        extraction = posterResult.extraction;
        source = "poster";
        fallbackSucceeded = true;
        break;
      } catch (err) {
        console.warn(`[poster-extract] Fallback extraction failed:`, err);
      }
    }
    if (!fallbackSucceeded) {
      throw new Error("Could not find a lineup poster in any of the candidate images");
    }
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
    deepScrapeCandidate,
  };
}
