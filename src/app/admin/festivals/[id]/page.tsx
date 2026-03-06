import { prisma } from "@/lib/prisma";
import { updateFestival, deleteFestival } from "@/lib/actions/festival";
import { notFound } from "next/navigation";
import { UK_REGIONS } from "@/lib/constants";

function formatDateForInput(date: Date): string {
  return date.toISOString().split("T")[0];
}

export default async function EditFestivalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const festival = await prisma.festival.findUnique({
    where: { id },
    include: {
      artists: {
        include: { artist: true },
        orderBy: { billing: "asc" },
      },
    },
  });

  if (!festival) {
    notFound();
  }

  const updateAction = updateFestival.bind(null, id);
  const deleteAction = deleteFestival.bind(null, id);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Edit Festival</h1>
        <form action={deleteAction}>
          <button
            type="submit"
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Delete Festival
          </button>
        </form>
      </div>

      <form action={updateAction} className="max-w-2xl space-y-6 bg-white p-6 rounded-lg shadow">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Festival Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={festival.name}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={festival.description ?? ""}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
              Start Date *
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={formatDateForInput(festival.startDate)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
              End Date *
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              required
              defaultValue={formatDateForInput(festival.endDate)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-gray-700">
              City *
            </label>
            <input
              id="city"
              name="city"
              type="text"
              required
              defaultValue={festival.city}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="region" className="block text-sm font-medium text-gray-700">
              Region *
            </label>
            <select
              id="region"
              name="region"
              required
              defaultValue={festival.region}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select region...</option>
              {UK_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="venue" className="block text-sm font-medium text-gray-700">
            Venue
          </label>
          <input
            id="venue"
            name="venue"
            type="text"
            defaultValue={festival.venue ?? ""}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="priceFrom" className="block text-sm font-medium text-gray-700">
              Price From
            </label>
            <input
              id="priceFrom"
              name="priceFrom"
              type="number"
              min="0"
              defaultValue={festival.priceFrom ?? ""}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="priceTo" className="block text-sm font-medium text-gray-700">
              Price To
            </label>
            <input
              id="priceTo"
              name="priceTo"
              type="number"
              min="0"
              defaultValue={festival.priceTo ?? ""}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="hasCamping"
            name="hasCamping"
            type="checkbox"
            defaultChecked={festival.hasCamping}
            className="rounded border-gray-300"
          />
          <label htmlFor="hasCamping" className="text-sm font-medium text-gray-700">
            Has Camping
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="websiteUrl" className="block text-sm font-medium text-gray-700">
              Website URL
            </label>
            <input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              defaultValue={festival.websiteUrl ?? ""}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="ticketUrl" className="block text-sm font-medium text-gray-700">
              Ticket URL
            </label>
            <input
              id="ticketUrl"
              name="ticketUrl"
              type="url"
              defaultValue={festival.ticketUrl ?? ""}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label htmlFor="status" className="block text-sm font-medium text-gray-700">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={festival.status}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="draft">Draft</option>
            <option value="pending_review">Pending Review</option>
            <option value="published">Published</option>
          </select>
        </div>

        <button
          type="submit"
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
        >
          Update Festival
        </button>
      </form>

      {/* Artists Section */}
      <div className="max-w-2xl mt-8">
        <h2 className="text-xl font-bold mb-4">Lineup</h2>
        {festival.artists.length === 0 ? (
          <p className="text-gray-400">No artists added yet.</p>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-sm font-medium text-gray-500">Artist</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-500">Billing</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {festival.artists.map((fa) => (
                  <tr key={fa.artistId}>
                    <td className="px-4 py-3">{fa.artist.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        fa.billing === "headliner" ? "bg-purple-100 text-purple-700"
                        : fa.billing === "support" ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-700"
                      }`}>{fa.billing}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
