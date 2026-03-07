import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scrapeUrl, hashContent } from "@/lib/scraping/scrape-url";
import { extractFestivalFromText } from "@/lib/ai/extract-festival";
import { extractFromPoster } from "@/lib/extraction";
import { slugify } from "@/lib/utils";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    festival: string;
    status: string;
    artistsAdded?: number;
  }> = [];

  // -----------------------------------------------------------------------
  // Type 1: Festivals with a lineupUrl — scrape text and extract artists
  // -----------------------------------------------------------------------

  const lineupFestivals = await prisma.festival.findMany({
    where: { lineupUrl: { not: null } },
    select: {
      id: true,
      name: true,
      lineupUrl: true,
      lineupHash: true,
    },
  });

  for (const festival of lineupFestivals) {
    try {
      const scrapeResult = await scrapeUrl(festival.lineupUrl!);

      if (scrapeResult.text.length < 50) {
        results.push({ festival: festival.name, status: "skipped_no_content" });
        continue;
      }

      const hash = hashContent(scrapeResult.text);

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
      const { extraction, usage } = await extractFestivalFromText(
        [{ url: festival.lineupUrl!, text: scrapeResult.text }],
        [],
        festival.lineupUrl!
      );

      await prisma.apiUsageLog.create({
        data: {
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          festivalId: festival.id,
          festivalName: festival.name,
          success: extraction.artists.length > 0,
        },
      });

      if (extraction.artists.length === 0) {
        results.push({ festival: festival.name, status: "no_artists_found" });
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

  // -----------------------------------------------------------------------
  // Type 2: Festivals with posterPageUrl but no lineupUrl — scrape images
  // -----------------------------------------------------------------------

  const posterFestivals = await prisma.festival.findMany({
    where: {
      posterPageUrl: { not: null },
      lineupUrl: null,
    },
    select: {
      id: true,
      name: true,
      posterPageUrl: true,
      lineupHash: true,
    },
  });

  for (const festival of posterFestivals) {
    try {
      const { images } = await scrapeUrl(festival.posterPageUrl!);

      if (images.length === 0) {
        results.push({ festival: festival.name, status: "skipped_no_images" });
        continue;
      }

      const hash = hashContent(
        images.map((i) => i.src).sort().join("|")
      );

      // Skip if images unchanged
      if (hash === festival.lineupHash) {
        await prisma.festival.update({
          where: { id: festival.id },
          data: { lastScrapedAt: new Date() },
        });
        results.push({ festival: festival.name, status: "unchanged" });
        continue;
      }

      // Images changed — extract from the best image (first = og:image if present)
      const bestImage = images[0];
      const { extraction, usage } = await extractFromPoster(bestImage.src);

      await prisma.apiUsageLog.create({
        data: {
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          festivalId: festival.id,
          festivalName: festival.name,
          success: extraction.artists.length > 0,
        },
      });

      if (extraction.artists.length === 0) {
        results.push({ festival: festival.name, status: "no_artists_found" });
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

  return NextResponse.json({
    processed: lineupFestivals.length + posterFestivals.length,
    results,
  });
}
