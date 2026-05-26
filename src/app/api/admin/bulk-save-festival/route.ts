import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createFestivalFromCrawl } from "@/lib/actions/festival";
import type { CrawlResult } from "@/lib/scraping/crawl-festival";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    crawlResult: CrawlResult;
    selectedPosterSrc: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.crawlResult) {
    return NextResponse.json({ error: "Missing crawlResult" }, { status: 400 });
  }

  try {
    const { festivalId, festivalName, artistCount } = await createFestivalFromCrawl(
      body.crawlResult,
      body.selectedPosterSrc
    );
    return NextResponse.json({ festivalId, festivalName, artistCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save festival";
    console.error("[bulk-save-festival] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
