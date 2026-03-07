"use server";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function updateArtist(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const genre = formData.get("genre") as string;
  const spotifyId = formData.get("spotifyId") as string;

  if (!name) {
    throw new Error("Name is required");
  }

  const artist = await prisma.artist.findUnique({ where: { id } });
  if (!artist) {
    throw new Error("Artist not found");
  }

  // Only update slug if name changed
  let slug = artist.slug;
  if (name !== artist.name) {
    slug = slugify(name);
    const existing = await prisma.artist.findUnique({ where: { slug } });
    if (existing && existing.id !== id) {
      slug = `${slug}-${Date.now()}`;
    }
  }

  await prisma.artist.update({
    where: { id },
    data: {
      name,
      slug,
      genre: genre || null,
      spotifyId: spotifyId || null,
    },
  });

  revalidatePath(`/admin/artists/${id}`);
  revalidatePath("/admin/artists");
}

export async function toggleNoSplit(id: string) {
  const artist = await prisma.artist.findUnique({ where: { id } });
  if (!artist) throw new Error("Artist not found");

  await prisma.artist.update({
    where: { id },
    data: { noSplit: !artist.noSplit },
  });

  revalidatePath(`/admin/artists/${id}`);
  revalidatePath("/admin/artists");
}

export async function deleteArtist(id: string) {
  await prisma.artist.delete({ where: { id } });
  revalidatePath("/admin/artists");
  redirect("/admin/artists");
}

export async function addArtistToFestival(festivalId: string, formData: FormData) {
  const artistName = (formData.get("artistName") as string)?.trim();
  const billing = (formData.get("billing") as string) || "support";

  if (!artistName) {
    throw new Error("Artist name is required");
  }

  const artistSlug = slugify(artistName);
  let artist = await prisma.artist.findUnique({ where: { slug: artistSlug } });
  if (!artist) {
    artist = await prisma.artist.create({
      data: { name: artistName, slug: artistSlug },
    });
  }

  // Check if already linked
  const existing = await prisma.festivalArtist.findUnique({
    where: { festivalId_artistId: { festivalId, artistId: artist.id } },
  });
  if (!existing) {
    await prisma.festivalArtist.create({
      data: {
        festivalId,
        artistId: artist.id,
        billing: billing as "headliner" | "support",
      },
    });
  }

  revalidatePath(`/admin/festivals/${festivalId}`);
}

export async function removeArtistFromFestival(festivalId: string, artistId: string) {
  await prisma.festivalArtist.delete({
    where: { festivalId_artistId: { festivalId, artistId } },
  });
  revalidatePath(`/admin/festivals/${festivalId}`);
}

export async function splitArtist(id: string, names: string[]) {
  if (names.length < 2 || names.some((n) => !n.trim())) {
    throw new Error("Need at least two non-empty artist names");
  }

  const original = await prisma.artist.findUnique({
    where: { id },
    include: { festivals: true },
  });
  if (!original) {
    throw new Error("Artist not found");
  }

  // Create or find each split artist, and link to all the same festivals
  for (const name of names) {
    const trimmed = name.trim();
    const slug = slugify(trimmed);
    let artist = await prisma.artist.findUnique({ where: { slug } });
    if (!artist) {
      artist = await prisma.artist.create({ data: { name: trimmed, slug } });
    }

    for (const fa of original.festivals) {
      const existing = await prisma.festivalArtist.findUnique({
        where: {
          festivalId_artistId: {
            festivalId: fa.festivalId,
            artistId: artist.id,
          },
        },
      });
      if (!existing) {
        await prisma.festivalArtist.create({
          data: {
            festivalId: fa.festivalId,
            artistId: artist.id,
            billing: fa.billing,
          },
        });
      }
    }
  }

  // Delete the original combined artist (cascades festival_artists)
  await prisma.artist.delete({ where: { id } });

  revalidatePath("/admin/artists");
  redirect("/admin/artists");
}

export async function updateArtistBilling(
  festivalId: string,
  artistId: string,
  formData: FormData
) {
  const billing = formData.get("billing") as string;
  if (!["headliner", "support"].includes(billing)) {
    throw new Error("Invalid billing");
  }

  await prisma.festivalArtist.update({
    where: { festivalId_artistId: { festivalId, artistId } },
    data: { billing: billing as "headliner" | "support" },
  });

  revalidatePath(`/admin/festivals/${festivalId}`);
}
