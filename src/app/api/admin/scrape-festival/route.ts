import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  crawlFestival,
  type CrawlProgress,
} from "@/lib/scraping/crawl-festival";

// Simple concurrency guard — only one scrape at a time
let activeScrape = false;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse request body
  let body: { url: string; festivalId?: string };
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

  // Concurrency check
  if (activeScrape) {
    return new Response(
      JSON.stringify({
        error:
          "A scrape is already in progress. Please wait for it to finish.",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  // AbortController to stop crawling when client disconnects
  const abortController = new AbortController();

  // Set up SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      activeScrape = true;

      function sendEvent(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        } catch {
          // Controller may be closed if client disconnected
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
            model: result.source.includes("poster")
              ? "claude-sonnet-4-6"
              : "claude-haiku-4-5-20251001",
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            festivalId: body.festivalId || null,
            festivalName: result.extraction.festival_name || null,
            success: true,
          },
        });

        // Create scrape log
        const scrapeLog = await prisma.scrapeLog.create({
          data: {
            festivalId: body.festivalId || null,
            url: body.url,
            source: result.source,
            status: "success",
            pagesScraped: result.pagesScraped,
            artistsFound: result.extraction.artists?.length ?? 0,
            lineupUrl: result.lineupUrl,
            lineupPending: result.lineupPending,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
        });

        // If festivalId provided, update the festival record
        if (body.festivalId) {
          await prisma.festival.update({
            where: { id: body.festivalId },
            data: {
              lineupUrl: result.lineupUrl,
              posterPageUrl: result.posterPageUrl,
              lastScrapedAt: new Date(),
              lineupPending: result.lineupPending,
            },
          });

          if (result.logoImageUrl) {
            try {
              // Remove any existing logo poster before inserting the new one
              await prisma.festivalPoster.deleteMany({
                where: { festivalId: body.festivalId, category: "logo" },
              });
              await prisma.festivalPoster.create({
                data: {
                  festivalId: body.festivalId,
                  category: "logo",
                  imageUrl: result.logoImageUrl,
                  version: 1,
                },
              });
            } catch (err) {
              console.error("[scrape-festival] Logo poster create failed:", err);
            }
          }
        }

        sendEvent("complete", {
          scrapeLogId: scrapeLog.id,
          extraction: result.extraction,
          source: result.source,
          lineupUrl: result.lineupUrl,
          posterPageUrl: result.posterPageUrl,
          imageCandidates: result.imageCandidates,
          algorithmPosterSrc: result.algorithmPosterSrc,
          lineupPending: result.lineupPending,
          logoImageUrl: result.logoImageUrl,
          usage: result.usage,
          pageTree: result.pageTree,
          pagesScraped: result.pagesScraped,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while scraping.";

        if (!abortController.signal.aborted) {
          await prisma.scrapeLog.create({
            data: {
              festivalId: body.festivalId || null,
              url: body.url,
              status: "error",
              errorMessage,
            },
          }).catch((err) => console.error("[scrape-festival] Failed to create error scrape log:", err));

          sendEvent("error", { message: errorMessage });
        } else {
          await prisma.scrapeLog.create({
            data: {
              festivalId: body.festivalId || null,
              url: body.url,
              status: "aborted",
            },
          }).catch((err) => console.error("[scrape-festival] Failed to create aborted scrape log:", err));
        }
      } finally {
        activeScrape = false;
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — abort the crawl
      abortController.abort();
      activeScrape = false;
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
