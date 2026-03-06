import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extractFromPoster } from "@/lib/extraction";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { posterUrl } = await req.json();

  if (!posterUrl) {
    return NextResponse.json({ error: "Missing posterUrl" }, { status: 400 });
  }

  try {
    logger.info("Starting poster extraction", { posterUrl });
    const { extraction, usage } = await extractFromPoster(posterUrl);
    logger.info("Extraction successful", { festivalName: extraction.festival_name, artistCount: extraction.artists.length });

    await prisma.apiUsageLog.create({
      data: {
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        festivalName: extraction.festival_name,
        success: true,
      },
    });

    return NextResponse.json({ extraction });
  } catch (error) {
    logger.error("Extraction failed", error);
    return NextResponse.json({ error: "Extraction failed", details: String(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { festivalId, artists } = await req.json();

  if (!festivalId || !artists) {
    return NextResponse.json({ error: "Missing festivalId or artists" }, { status: 400 });
  }

  // Fetch existing artist associations to merge (not replace)
  const existingLinks = await prisma.festivalArtist.findMany({
    where: { festivalId },
    include: { artist: { select: { slug: true } } },
  });
  const existingSlugs = new Set(existingLinks.map((link) => link.artist.slug));

  // Create or find artists and link only those not already associated
  let added = 0;
  for (const a of artists as Array<{ name: string; billing: string }>) {
    const slug = slugify(a.name);

    // Skip if this artist is already linked to the festival
    if (existingSlugs.has(slug)) continue;

    let artist = await prisma.artist.findUnique({ where: { slug } });

    if (!artist) {
      artist = await prisma.artist.create({
        data: { name: a.name, slug },
      });
    }

    await prisma.festivalArtist.create({
      data: {
        festivalId,
        artistId: artist.id,
        billing: (a.billing as "headliner" | "support") || "support",
      },
    });
    added++;
  }

  return NextResponse.json({ success: true, added, existing: existingSlugs.size });
}
