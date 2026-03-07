"use server";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";

export async function saveScrapedArtists(
  festivalId: string,
  artists: Array<{ name: string; billing: "headliner" | "support" }>
) {
  const existingLinks = await prisma.festivalArtist.findMany({
    where: { festivalId },
    include: { artist: { select: { slug: true } } },
  });
  const existingSlugs = new Set(existingLinks.map((link) => link.artist.slug));

  let added = 0;
  for (const a of artists) {
    const slug = slugify(a.name);
    if (existingSlugs.has(slug)) continue;

    let artist = await prisma.artist.findUnique({ where: { slug } });
    if (!artist) {
      artist = await prisma.artist.create({ data: { name: a.name, slug } });
    }

    await prisma.festivalArtist.create({
      data: {
        festivalId,
        artistId: artist.id,
        billing: a.billing || "support",
      },
    });
    added++;
  }

  revalidatePath(`/admin/festivals/${festivalId}`);
  return { added, existing: existingSlugs.size };
}
