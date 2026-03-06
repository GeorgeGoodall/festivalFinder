import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const festivalName = formData.get("festivalName") as string;
  const locationHint = formData.get("locationHint") as string;
  const submitterEmail = formData.get("submitterEmail") as string;
  const file = formData.get("poster") as File | null;

  if (!festivalName) {
    return NextResponse.json(
      { error: "Festival name is required" },
      { status: 400 }
    );
  }

  // Duplicate check: fuzzy match on name
  const existing = await prisma.festival.findFirst({
    where: {
      name: { contains: festivalName, mode: "insensitive" },
      status: "published",
    },
  });

  if (existing) {
    return NextResponse.json(
      {
        error: "duplicate",
        message: `"${existing.name}" already exists in our database.`,
      },
      { status: 409 }
    );
  }

  // Also check pending submissions
  const existingSubmission = await prisma.userSubmission.findFirst({
    where: {
      festivalName: { contains: festivalName, mode: "insensitive" },
      status: "pending",
    },
  });

  if (existingSubmission) {
    return NextResponse.json(
      {
        error: "duplicate",
        message:
          "This festival has already been submitted and is awaiting review.",
      },
      { status: 409 }
    );
  }

  let posterImageUrl: string | null = null;
  if (file) {
    const ext = file.name.split(".").pop();
    const fileName = `submissions/${Date.now()}.${ext}`;
    const { error } = await supabaseAdmin.storage
      .from("posters")
      .upload(fileName, file, { contentType: file.type });

    if (!error) {
      const { data } = supabaseAdmin.storage
        .from("posters")
        .getPublicUrl(fileName);
      posterImageUrl = data.publicUrl;
    }
  }

  await prisma.userSubmission.create({
    data: {
      festivalName,
      locationHint: locationHint || null,
      submitterEmail: submitterEmail || null,
      posterImageUrl,
    },
  });

  return NextResponse.json({ success: true });
}
