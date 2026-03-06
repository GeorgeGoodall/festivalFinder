import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchPage, cleanHtml, hashContent, extractFromPage } from "@/lib/scraping";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, festivalId } = await req.json();

  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const html = await fetchPage(url);
    const { text, jsonLd } = cleanHtml(html);

    if (text.length < 50) {
      return NextResponse.json({
        error:
          "Page returned very little text content. This site may require JavaScript rendering, which is not currently supported.",
      }, { status: 422 });
    }

    const { extraction, usage } = await extractFromPage(text, jsonLd);

    // Log API usage
    await prisma.apiUsageLog.create({
      data: {
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        festivalId: festivalId || null,
        festivalName: null,
        success: extraction.isLineupPage,
      },
    });

    // If we have a festivalId, update the lineup hash
    if (festivalId) {
      const hash = hashContent(text);
      await prisma.festival.update({
        where: { id: festivalId },
        data: {
          lineupUrl: url,
          lineupHash: hash,
          lastScrapedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ extraction });
  } catch (error) {
    return NextResponse.json(
      { error: "Scraping failed", details: String(error) },
      { status: 500 }
    );
  }
}
