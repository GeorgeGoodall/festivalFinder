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
  const city = formData.get("city") as string;
  const region = formData.get("region") as string;
  const venue = formData.get("venue") as string;
  const priceFrom = formData.get("priceFrom") as string;
  const priceTo = formData.get("priceTo") as string;
  const hasCamping = formData.get("hasCamping") === "on";
  const websiteUrl = formData.get("websiteUrl") as string;
  const ticketUrl = formData.get("ticketUrl") as string;

  let slug = slugify(name);
  const existing = await prisma.festival.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now()}`;
  }

  const festival = await prisma.festival.create({
    data: {
      name,
      slug,
      description: description || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      city,
      region,
      venue: venue || null,
      priceFrom: priceFrom ? parseInt(priceFrom) : null,
      priceTo: priceTo ? parseInt(priceTo) : null,
      hasCamping,
      websiteUrl: websiteUrl || null,
      ticketUrl: ticketUrl || null,
      status: "draft",
    },
  });

  redirect(`/admin/festivals/${festival.id}`);
}

export async function updateFestival(id: string, formData: FormData) {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const startDate = formData.get("startDate") as string;
  const endDate = formData.get("endDate") as string;
  const city = formData.get("city") as string;
  const region = formData.get("region") as string;
  const venue = formData.get("venue") as string;
  const priceFrom = formData.get("priceFrom") as string;
  const priceTo = formData.get("priceTo") as string;
  const hasCamping = formData.get("hasCamping") === "on";
  const websiteUrl = formData.get("websiteUrl") as string;
  const ticketUrl = formData.get("ticketUrl") as string;
  const status = formData.get("status") as string;

  await prisma.festival.update({
    where: { id },
    data: {
      name,
      description: description || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      city,
      region,
      venue: venue || null,
      priceFrom: priceFrom ? parseInt(priceFrom) : null,
      priceTo: priceTo ? parseInt(priceTo) : null,
      hasCamping,
      websiteUrl: websiteUrl || null,
      ticketUrl: ticketUrl || null,
      status: status as "draft" | "pending_review" | "published",
    },
  });

  revalidatePath(`/admin/festivals/${id}`);
  revalidatePath("/admin/festivals");
}

export async function deleteFestival(id: string) {
  await prisma.festival.delete({ where: { id } });
  revalidatePath("/admin/festivals");
  redirect("/admin/festivals");
}
