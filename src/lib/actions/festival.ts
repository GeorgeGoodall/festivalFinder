"use server";

import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function uploadImageFromUrl(src: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(src, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = contentType.includes("png")
      ? ".png"
      : contentType.includes("webp")
      ? ".webp"
      : ".jpg";
    const filename = `crawled-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("posters")
      .upload(filename, buffer, { contentType, upsert: false });
    if (error) return null;
    return supabaseAdmin.storage.from("posters").getPublicUrl(filename).data.publicUrl;
  } catch {
    return null;
  }
}

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
  const selectedPosterSrcsRaw = formData.get("selectedPosterSrcs") as string | null;
  const selectedLogoSrc = formData.get("selectedLogoSrc") as string | null;
  let selectedPosterSrcs: string[] = [];
  if (selectedPosterSrcsRaw) {
    try {
      selectedPosterSrcs = JSON.parse(selectedPosterSrcsRaw);
    } catch {
      console.error("[createFestival] Failed to parse selectedPosterSrcs");
    }
  }
  const artistsJson = formData.get("artists") as string;
  const lineupUrl = formData.get("lineupUrl") as string;
  const posterPageUrl = formData.get("posterPageUrl") as string | null;
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

  // Upload and create FestivalPoster records for selected lineup posters
  for (const src of selectedPosterSrcs) {
    try {
      const uploadedUrl = await uploadImageFromUrl(src);
      if (!uploadedUrl) continue;
      await prisma.festivalPoster.create({
        data: {
          festivalId: festival.id,
          category: "full_lineup",
          imageUrl: uploadedUrl,
          version: 1,
        },
      });
    } catch (err) {
      console.error("[createFestival] Poster upload failed:", err);
    }
  }

  // Upload and create FestivalPoster record for selected logo
  if (selectedLogoSrc) {
    try {
      // If it's already a Supabase URL (uploaded during crawl), use directly
      const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const logoUrl = supabaseBase && selectedLogoSrc.startsWith(supabaseBase)
        ? selectedLogoSrc
        : await uploadImageFromUrl(selectedLogoSrc);
      if (logoUrl) {
        await prisma.festivalPoster.create({
          data: {
            festivalId: festival.id,
            category: "logo",
            imageUrl: logoUrl,
            version: 1,
          },
        });
      }
    } catch (err) {
      console.error("[createFestival] Logo upload failed:", err);
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
