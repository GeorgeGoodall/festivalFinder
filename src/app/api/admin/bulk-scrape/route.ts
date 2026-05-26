import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { crawlFestival, type CrawlProgress } from "@/lib/scraping/crawl-festival";
import { createFestivalFromCrawl } from "@/lib/actions/festival";
import { prisma } from "@/lib/prisma";

let activeBulkScrape = false;

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

  if (activeBulkScrape) {
    return new Response(
      JSON.stringify({ error: "A bulk scrape is already in progress." }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  const abortController = new AbortController();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      activeBulkScrape = true;

      function sendEvent(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          abortController.abort();
        }
      }

      try {
        const result = await crawlFestival(body.url, {
          signal: abortController.signal,
          onProgress: (progress: CrawlProgress) => {
            sendEvent("progress", progress);
          },
        });

        // Log API usage
        await prisma.apiUsageLog.create({
          data: {
            model: result.source.includes("poster") ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001",
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            festivalId: null,
            festivalName: result.extraction.festival_name || null,
            success: true,
          },
        }).catch((err) => console.error("[bulk-scrape] ApiUsageLog failed:", err));

        if (result.posterIsUnambiguous) {
          // Auto-save as draft
          const { festivalId, festivalName, artistCount } = await createFestivalFromCrawl(
            result,
            result.algorithmPosterSrc
          );
          sendEvent("complete", {
            autoSaved: true,
            festivalId,
            festivalName,
            artistCount,
            lineupPending: result.lineupPending,
            usage: result.usage,
          });
        } else {
          // Return data for inline review
          sendEvent("complete", {
            autoSaved: false,
            needsReview: true,
            extraction: result.extraction,
            imageCandidates: result.imageCandidates,
            algorithmPosterSrc: result.algorithmPosterSrc,
            lineupUrl: result.lineupUrl,
            posterPageUrl: result.posterPageUrl,
            lineupPending: result.lineupPending,
            logoImageUrl: result.logoImageUrl,
            source: result.source,
            pagesScraped: result.pagesScraped,
            deepScrapeCandidate: result.deepScrapeCandidate,
            usage: result.usage,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
        if (!abortController.signal.aborted) {
          sendEvent("error", { message: errorMessage });
        }
      } finally {
        activeBulkScrape = false;
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
      activeBulkScrape = false;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
