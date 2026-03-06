import { prisma } from "@/lib/prisma";

export default async function AdminDashboardPage() {
  const [festivalCount, pendingSubmissions] = await Promise.all([
    prisma.festival.count({ where: { status: "published" } }),
    prisma.userSubmission.count({ where: { status: "pending" } }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-3xl font-bold">{festivalCount}</p>
          <p className="text-gray-500">Published Festivals</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-3xl font-bold">{pendingSubmissions}</p>
          <p className="text-gray-500">Pending Submissions</p>
        </div>
      </div>
    </div>
  );
}
