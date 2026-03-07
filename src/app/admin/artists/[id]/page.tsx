import { prisma } from "@/lib/prisma";
import { updateArtist, deleteArtist, toggleNoSplit } from "@/lib/actions/artist";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DeleteArtistButton } from "./delete-artist-button";
import { SplitArtistSection } from "./split-artist-section";
import { detectSplit } from "@/lib/artist-split";

export const dynamic = "force-dynamic";

export default async function EditArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const artist = await prisma.artist.findUnique({
    where: { id },
    include: {
      festivals: {
        include: { festival: true },
      },
    },
  });

  if (!artist) {
    notFound();
  }

  const updateAction = updateArtist.bind(null, id);
  const deleteAction = deleteArtist.bind(null, id);
  const split = detectSplit(artist.name);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Edit Artist</h1>
        <DeleteArtistButton
          deleteAction={deleteAction}
          festivalCount={artist.festivals.length}
        />
      </div>

      {split && !artist.noSplit && (
        <SplitArtistSection
          artistId={id}
          parts={split.parts}
          connector={split.connector}
          dismissAction={toggleNoSplit.bind(null, id)}
        />
      )}

      {split && artist.noSplit && (
        <div className="max-w-2xl mt-6 flex items-center gap-3 text-sm text-gray-500">
          <span>Split detection dismissed.</span>
          <form action={toggleNoSplit.bind(null, id)} className="inline">
            <button type="submit" className="text-blue-600 hover:underline">
              Undo
            </button>
          </form>
          <span className="text-gray-300">|</span>
          <SplitArtistSection
            artistId={id}
            parts={split.parts}
            connector={split.connector}
            collapsed
          />
        </div>
      )}

      <form action={updateAction} className="max-w-2xl space-y-6 bg-white p-6 rounded-lg shadow mt-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={artist.name}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="genre" className="block text-sm font-medium text-gray-700">
            Genre
          </label>
          <input
            id="genre"
            name="genre"
            type="text"
            defaultValue={artist.genre ?? ""}
            placeholder="e.g. Rock, Electronic, Indie"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="spotifyId" className="block text-sm font-medium text-gray-700">
            Spotify ID
          </label>
          <input
            id="spotifyId"
            name="spotifyId"
            type="text"
            defaultValue={artist.spotifyId ?? ""}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
        >
          Update Artist
        </button>
      </form>

      <div className="max-w-2xl mt-8">
        <h2 className="text-xl font-bold mb-4">Festivals</h2>
        {artist.festivals.length === 0 ? (
          <p className="text-gray-700">This artist is not on any festival lineups.</p>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-sm font-medium text-gray-700">Festival</th>
                  <th className="px-4 py-3 text-sm font-medium text-gray-700">Billing</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {artist.festivals.map((fa) => (
                  <tr key={fa.festivalId}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/festivals/${fa.festivalId}`}
                        className="text-blue-600 hover:underline"
                      >
                        {fa.festival.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          fa.billing === "headliner"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {fa.billing}
                      </span>
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
