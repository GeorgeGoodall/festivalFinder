import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminSubmissionsPage() {
  const submissions = await prisma.userSubmission.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">User Submissions</h1>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">
                Festival Name
              </th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">
                Location
              </th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">
                Poster
              </th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">
                Submitted
              </th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {submissions.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/submissions/${s.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {s.festivalName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {s.locationHint || "-"}
                </td>
                <td className="px-4 py-3 text-sm">
                  {s.posterImageUrl ? "Yes" : "No"}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {s.createdAt.toLocaleDateString("en-GB")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      s.status === "approved"
                        ? "bg-green-100 text-green-700"
                        : s.status === "rejected"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {s.status}
                  </span>
                </td>
              </tr>
            ))}
            {submissions.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-gray-600"
                >
                  No submissions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
