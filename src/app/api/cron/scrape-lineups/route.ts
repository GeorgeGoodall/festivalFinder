import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchPage,
  cleanHtml,
  hashContent,
  extractFromPage,
} from "@/lib/scraping";
import { slugify } from "@/lib/utils";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const festivals = await prisma.festival.findMany({
    where: { lineupUrl: { not: null } },
    select: {
      id: true,
      name: true,
      lineupUrl: true,
      lineupHash: true,
    },
  });

  const results: Array<{
    festival: string;
    status: string;
    artistsAdded?: number;
  }> = [];

  for (const festival of festivals) {
    try {
      const html = await fetchPage(festival.lineupUrl!);
      const { text, jsonLd } = cleanHtml(html);

      if (text.length < 50) {
        results.push({ festival: festival.name, status: "skipped_no_content" });
        continue;
      }

      const hash = hashContent(text);

      // Skip if content unchanged
      if (hash === festival.lineupHash) {
        await prisma.festival.update({
          where: { id: festival.id },
          data: { lastScrapedAt: new Date() },
        });
        results.push({ festival: festival.name, status: "unchanged" });
        continue;
      }

      // Content changed — re-extract
      const { extraction, usage } = await extractFromPage(text, jsonLd);

      await prisma.apiUsageLog.create({
        data: {
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          festivalId: festival.id,
          festivalName: festival.name,
          success: extraction.isLineupPage,
        },
      });

      if (!extraction.isLineupPage) {
        results.push({ festival: festival.name, status: "not_lineup_page" });
        continue;
      }

      // Merge new artists (don't remove existing ones)
      const existingLinks = await prisma.festivalArtist.findMany({
        where: { festivalId: festival.id },
        include: { artist: { select: { slug: true } } },
      });
      const existingSlugs = new Set(existingLinks.map((l) => l.artist.slug));

      let added = 0;
      for (const a of extraction.artists) {
        const slug = slugify(a.name);
        if (existingSlugs.has(slug)) continue;

        let artist = await prisma.artist.findUnique({ where: { slug } });
        if (!artist) {
          artist = await prisma.artist.create({
            data: { name: a.name, slug },
          });
        }

        await prisma.festivalArtist.create({
          data: {
            festivalId: festival.id,
            artistId: artist.id,
            billing: a.billing || "support",
          },
        });
        added++;
      }

      // Update hash and timestamp
      await prisma.festival.update({
        where: { id: festival.id },
        data: { lineupHash: hash, lastScrapedAt: new Date() },
      });

      results.push({
        festival: festival.name,
        status: "updated",
        artistsAdded: added,
      });

      // Small delay between festivals to be polite
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      results.push({
        festival: festival.name,
        status: `error: ${String(error)}`,
      });
    }
  }

  return NextResponse.json({ processed: festivals.length, results });
}
