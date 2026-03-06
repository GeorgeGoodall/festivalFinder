"use server";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createFestival(formData: FormData) {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const location = formData.get("location") as string;
  const region = formData.get("region") as string;
  const priceFrom = formData.get("priceFrom") as string;
  const priceTo = formData.get("priceTo") as string;
  const hasCamping = formData.get("hasCamping") === "on";
  const websiteUrl = formData.get("websiteUrl") as string;
  const ticketUrl = formData.get("ticketUrl") as string;
  const posterImageUrl = formData.get("posterImageUrl") as string;
  const artistsJson = formData.get("artists") as string;
  const lineupUrl = formData.get("lineupUrl") as string;

  if (!name || !startDate || !endDate || !location || !region) {
    throw new Error("Missing required fields");
  }

  let slug = slugify(name);
  const existing = await prisma.festival.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now()}`;
  }

  let festival;
  try {
    festival = await prisma.festival.create({
      data: {
        name,
        slug,
        description: description || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        location,
        region,
        priceFrom: priceFrom ? parseInt(priceFrom) : null,
        priceTo: priceTo ? parseInt(priceTo) : null,
        hasCamping,
        websiteUrl: websiteUrl || null,
        ticketUrl: ticketUrl || null,
        lineupUrl: lineupUrl || null,
        status: "draft",
      },
    });
  } catch (error) {
    throw new Error("Failed to create festival");
  }

  // Create artists from extraction if provided
  if (artistsJson) {
    try {
      const artists = JSON.parse(artistsJson) as Array<{ name: string; billing: string }>;
      for (const a of artists) {
        const artistSlug = slugify(a.name);
        let artist = await prisma.artist.findUnique({ where: { slug: artistSlug } });
        if (!artist) {
          artist = await prisma.artist.create({ data: { name: a.name, slug: artistSlug } });
        }
        await prisma.festivalArtist.create({
          data: {
            festivalId: festival.id,
            artistId: artist.id,
            billing: (a.billing as "headliner" | "support") || "support",
          },
        });
      }
    } catch {
      // Artist creation is best-effort, don't fail the whole creation
    }
  }

  // Create FestivalPoster record if a poster was uploaded
  if (posterImageUrl) {
    await prisma.festivalPoster.create({
      data: {
        festivalId: festival.id,
        category: "full_lineup",
        imageUrl: posterImageUrl,
        version: 1,
      },
    });
  }

  redirect(`/admin/festivals/${festival.id}`);
}

export async function updateFestival(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const location = formData.get("location") as string;
  const region = formData.get("region") as string;
  const priceFrom = formData.get("priceFrom") as string;
  const priceTo = formData.get("priceTo") as string;
  const hasCamping = formData.get("hasCamping") === "on";
  const websiteUrl = formData.get("websiteUrl") as string;
  const ticketUrl = formData.get("ticketUrl") as string;
  const status = formData.get("status") as string;
  const lineupUrl = formData.get("lineupUrl") as string;

  if (!name || !startDate || !endDate || !location || !region) {
    throw new Error("Missing required fields");
  }

  const validStatuses = ["draft", "pending_review", "published"];
  if (status && !validStatuses.includes(status)) {
    throw new Error("Invalid status");
  }

  try {
    await prisma.festival.update({
      where: { id },
      data: {
        name,
        description: description || null,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        location,
        region,
        priceFrom: priceFrom ? parseInt(priceFrom) : null,
        priceTo: priceTo ? parseInt(priceTo) : null,
        hasCamping,
        websiteUrl: websiteUrl || null,
        ticketUrl: ticketUrl || null,
        lineupUrl: lineupUrl || null,
        status: status as "draft" | "pending_review" | "published",
      },
    });
  } catch (error) {
    throw new Error("Failed to update festival");
  }

  revalidatePath(`/admin/festivals/${id}`);
  revalidatePath("/admin/festivals");
}

export async function deleteFestival(id: string) {
  try {
    await prisma.festival.delete({ where: { id } });
  } catch (error) {
    throw new Error("Failed to delete festival");
  }
  revalidatePath("/admin/festivals");
  redirect("/admin/festivals");
}
