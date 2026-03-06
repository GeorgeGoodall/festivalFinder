import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PosterCategory } from "@/generated/prisma/client";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const festivalId = formData.get("festivalId") as string | null;
  const category = (formData.get("category") as string) || "full_lineup";
  const customCategory = formData.get("customCategory") as string | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const ext = file.name.split(".").pop();
  const prefix = festivalId || `temp-${Date.now()}`;
  const fileName = `${prefix}-${category}-${Date.now()}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from("posters")
    .upload(fileName, file, { contentType: file.type });

  if (error) {
    logger.error("Poster upload failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: urlData } = supabaseAdmin.storage
    .from("posters")
    .getPublicUrl(fileName);

  let poster = null;

  if (festivalId) {
    // Auto-version: find the max version for this festival+category
    const existing = await prisma.festivalPoster.findMany({
      where: { festivalId, category: category as PosterCategory },
      orderBy: { version: "desc" },
      take: 1,
    });
    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

    poster = await prisma.festivalPoster.create({
      data: {
        festivalId,
        category: category as PosterCategory,
        customCategory: customCategory || null,
        imageUrl: urlData.publicUrl,
        version: nextVersion,
      },
    });
  }

  return NextResponse.json({ url: urlData.publicUrl, poster });
}
