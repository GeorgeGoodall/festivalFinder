import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const festivalId = formData.get("festivalId") as string | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const ext = file.name.split(".").pop();
  const prefix = festivalId || `temp-${Date.now()}`;
  const fileName = `${prefix}-${Date.now()}.${ext}`;

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

  if (festivalId) {
    await prisma.festival.update({
      where: { id: festivalId },
      data: { posterImageUrl: urlData.publicUrl },
    });
  }

  return NextResponse.json({ url: urlData.publicUrl });
}
