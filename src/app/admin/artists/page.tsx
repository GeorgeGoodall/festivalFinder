import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { detectSplit } from "@/lib/artist-split";

export const dynamic = "force-dynamic";

type ArtistIssue = {
  type: "splittable";
  label: string;
};

function getIssues(artist: { name: string; noSplit: boolean }): ArtistIssue[] {
  const issues: ArtistIssue[] = [];
  const split = detectSplit(artist.name);
  if (split && !artist.noSplit) {
    issues.push({ type: "splittable", label: "May need splitting" });
  }
  return issues;
}

export default async function AdminArtistsPage() {
  const artists = await prisma.artist.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { festivals: true } } },
  });

  const needsAttention = artists
    .map((a) => ({ artist: a, issues: getIssues(a) }))
    .filter((entry) => entry.issues.length > 0);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Artists</h1>
      </div>

      {needsAttention.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3 text-amber-800">
            Needs attention ({needsAttention.length})
          </h2>
          <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-amber-100/50 border-b border-amber-200">
                <tr>
                  <th className="px-4 py-3 text-sm font-medium text-amber-800">Name</th>
                  <th className="px-4 py-3 text-sm font-medium text-amber-800">Issue</th>
                  <th className="px-4 py-3 text-sm font-medium text-amber-800">Festivals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-200">
                {needsAttention.map(({ artist: a, issues }) => (
                  <tr key={a.id} className="hover:bg-amber-100/30">
                    <td className="px-4 py-3">
                      <Link href={`/admin/artists/${a.id}`} className="text-amber-900 hover:underline font-medium">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {issues.map((issue, i) => (
                          <span
                            key={i}
                            className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded"
                          >
                            {issue.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-amber-700">{a._count.festivals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3">All artists ({artists.length})</h2>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Genre</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Festivals</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {artists.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/artists/${a.id}`} className="text-blue-600 hover:underline">
                    {a.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{a.genre ?? "-"}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{a._count.festivals}</td>
              </tr>
            ))}
            {artists.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-600">
                  No artists yet. Artists are created when added to festival lineups.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
