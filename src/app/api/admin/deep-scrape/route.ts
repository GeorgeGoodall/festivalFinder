import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { scrapeUrlWithBrowser } from "@/lib/scraping/scrape-url-browser";
import { extractFestivalFromText } from "@/lib/ai/extract-festival";

// Simple concurrency guard — only one deep scrape at a time
let activeDeepScrape = false;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse request body
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

  // Concurrency check
  if (activeDeepScrape) {
    return new Response(
      JSON.stringify({
        error:
          "A deep scrape is already in progress. Please wait for it to finish.",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  // Set up SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      activeDeepScrape = true;

      function sendEvent(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
            )
          );
        } catch {
          // Controller may be closed if client disconnected
        }
      }

      try {
        const scrapeResult = await scrapeUrlWithBrowser(
          body.url,
          (message: string) => {
            sendEvent("progress", { message });
          }
        );

        sendEvent("progress", {
          message: `Scrape complete: ${scrapeResult.images.length} images, ${scrapeResult.text.length} chars of text.`,
        });

        const { extraction } = await extractFestivalFromText(
          [{ url: scrapeResult.url, text: scrapeResult.text }],
          [],
          body.url
        );

        const artistCount = extraction.artists?.length ?? 0;
        sendEvent("progress", {
          message: `Extraction complete: found ${artistCount} artist(s).`,
        });

        sendEvent("complete", {
          artists: extraction.artists ?? [],
          pageTitle: scrapeResult.title,
          imageCount: scrapeResult.images.length,
          textLength: scrapeResult.text.length,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during deep scrape.";

        sendEvent("error", { message: errorMessage });
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
