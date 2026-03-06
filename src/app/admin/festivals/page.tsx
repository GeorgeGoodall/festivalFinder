import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminFestivalsPage() {
  const festivals = await prisma.festival.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { artists: true } } },
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Festivals</h1>
        <Link href="/admin/festivals/new" className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800">
          Add Festival
        </Link>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Name</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Date</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Location</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Artists</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-500">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {festivals.map((f) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/festivals/${f.id}`} className="text-blue-600 hover:underline">{f.name}</Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{f.startDate.toLocaleDateString("en-GB")}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{f.city}, {f.region}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{f._count.artists}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    f.status === "published" ? "bg-green-100 text-green-700"
                    : f.status === "draft" ? "bg-gray-100 text-gray-700"
                    : "bg-yellow-100 text-yellow-700"
                  }`}>{f.status}</span>
                </td>
              </tr>
            ))}
            {festivals.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No festivals yet. Add your first one!</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
