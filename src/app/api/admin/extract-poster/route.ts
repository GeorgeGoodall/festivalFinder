import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extractFromPoster } from "@/lib/extraction";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { festivalId, posterUrl } = await req.json();

  if (!festivalId || !posterUrl) {
    return NextResponse.json({ error: "Missing festivalId or posterUrl" }, { status: 400 });
  }

  try {
    const result = await extractFromPoster(posterUrl);
    return NextResponse.json({ extraction: result });
  } catch (error) {
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { festivalId, artists } = await req.json();

  if (!festivalId || !artists) {
    return NextResponse.json({ error: "Missing festivalId or artists" }, { status: 400 });
  }

  // Delete existing artist associations
  await prisma.festivalArtist.deleteMany({ where: { festivalId } });

  // Create or find artists and link them
  for (const a of artists as Array<{ name: string; billing: string }>) {
    const slug = slugify(a.name);
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
        billing: (a.billing as "headliner" | "support" | "other") || "other",
      },
    });
  }

  return NextResponse.json({ success: true });
}
