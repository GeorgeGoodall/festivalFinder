import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const submission = await prisma.userSubmission.findUnique({ where: { id } });
  if (!submission) notFound();

  async function approve() {
    "use server";
    await prisma.userSubmission.update({
      where: { id },
      data: { status: "approved" },
    });
    revalidatePath("/admin/submissions");
    redirect(
      `/admin/festivals/new?name=${encodeURIComponent(submission!.festivalName)}&location=${encodeURIComponent(submission!.locationHint || "")}&poster=${encodeURIComponent(submission!.posterImageUrl || "")}`
    );
  }

  async function reject() {
    "use server";
    await prisma.userSubmission.update({
      where: { id },
      data: { status: "rejected" },
    });
    revalidatePath("/admin/submissions");
    redirect("/admin/submissions");
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">
        Submission: {submission.festivalName}
      </h1>
      <div className="bg-white p-6 rounded-lg shadow space-y-4">
        <div>
          <p className="text-sm text-gray-500">Festival Name</p>
          <p className="font-medium">{submission.festivalName}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Location Hint</p>
          <p>{submission.locationHint || "Not provided"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Submitter Email</p>
          <p>{submission.submitterEmail || "Not provided"}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Status</p>
          <p className="capitalize">{submission.status}</p>
        </div>
        {submission.posterImageUrl && (
          <div>
            <p className="text-sm text-gray-500 mb-2">Poster</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={submission.posterImageUrl}
              alt="Submitted poster"
              className="max-w-sm rounded"
            />
          </div>
        )}
        {submission.status === "pending" && (
          <div className="flex gap-3 pt-4">
            <form action={approve}>
              <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                Approve & Create Festival
              </button>
            </form>
            <form action={reject}>
              <button className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700">
                Reject
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
