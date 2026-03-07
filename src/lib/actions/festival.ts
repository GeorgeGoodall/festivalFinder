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
  const posterPageUrl = formData.get("posterPageUrl") as string | null;
  const logoImageUrl = formData.get("logoImageUrl") as string | null;
  const lineupPendingStr = formData.get("lineupPending") as string | null;
  const lineupPending = lineupPendingStr === "true";

  if (!name || !startDate || !endDate || !location || !region) {
    throw new Error("Missing required fields");
  }

  let slug = slugify(name);
  const existing = await prisma.festival.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now()}`;
  }

  const parsedStart = new Date(startDate);
  const parsedEnd = new Date(endDate);
  if (isNaN(parsedStart.getTime())) throw new Error("Invalid start date");
  if (isNaN(parsedEnd.getTime())) throw new Error("Invalid end date");

  let festival;
  try {
    festival = await prisma.festival.create({
      data: {
        name,
        slug,
        description: description || null,
        startDate: parsedStart,
        endDate: parsedEnd,
        location,
        region,
        priceFrom: priceFrom ? parseInt(priceFrom) : null,
        priceTo: priceTo ? parseInt(priceTo) : null,
        hasCamping,
        websiteUrl: websiteUrl || null,
        ticketUrl: ticketUrl || null,
        lineupUrl: lineupUrl || null,
        posterPageUrl: posterPageUrl || null,
        lineupPending,
        status: formData.get("publish") === "true" ? "published" : "draft",
      },
    });
  } catch (error) {
    console.error("[createFestival] Prisma error:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to create festival"
    );
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
    } catch (error) {
      console.error("[createFestival] Artist creation error:", error);
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

  // Create FestivalPoster record for the logo if one was captured
  if (logoImageUrl) {
    try {
      await prisma.festivalPoster.create({
        data: {
          festivalId: festival.id,
          category: "logo",
          imageUrl: logoImageUrl,
          version: 1,
        },
      });
    } catch (err) {
      console.error("[createFestival] Logo poster create failed:", err);
    }
  }

  if (formData.get("publish") === "true") {
    redirect("/admin/festivals/new");
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
  const lineupPending = formData.get("lineupPending") === "on";
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
        lineupPending,
        websiteUrl: websiteUrl || null,
        ticketUrl: ticketUrl || null,
        lineupUrl: lineupUrl || null,
        status: status as "draft" | "pending_review" | "published",
      },
    });
  } catch (error) {
    console.error("[updateFestival] Prisma error:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to update festival"
    );
  }

  revalidatePath(`/admin/festivals/${id}`);
  revalidatePath("/admin/festivals");
}

export async function deleteFestival(id: string) {
  try {
    await prisma.festival.delete({ where: { id } });
  } catch (error) {
    console.error("[deleteFestival] Prisma error:", error);
    throw new Error(
      error instanceof Error ? error.message : "Failed to delete festival"
    );
  }
  revalidatePath("/admin/festivals");
  redirect("/admin/festivals");
}
