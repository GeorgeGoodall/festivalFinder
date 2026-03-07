import Link from "next/link";
import { getFeaturedFestivals } from "@/lib/queries";
import { FestivalCard } from "@/components/festival-card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Festival Finder | Find UK Music Festivals",
  description:
    "Search UK music festivals by your favourite artists, dates, location, price and more.",
};

export default async function HomePage() {
  const featured = await getFeaturedFestivals();

  return (
    <div>
      <section className="bg-gradient-to-br from-purple-600 to-pink-500 text-white py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold mb-4">Find Your Festival</h1>
          <p className="text-xl mb-8 text-white/80">
            Search UK music festivals by your favourite artists
          </p>
          <form
            action="/festivals"
            method="get"
            className="max-w-xl mx-auto flex gap-2"
          >
            <input
              name="artist"
              placeholder="Search by artist name..."
              className="flex-1 rounded-lg px-4 py-3 text-gray-900 text-lg"
            />
            <button
              type="submit"
              className="bg-black text-white px-8 py-3 rounded-lg hover:bg-gray-800 font-medium"
            >
              Search
            </button>
          </form>
          <div className="mt-4">
            <Link
              href="/festivals"
              className="text-white/70 hover:text-white underline text-sm"
            >
              Browse all festivals with filters
            </Link>
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-2xl font-bold mb-6">Upcoming Festivals</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured.map((f) => (
              <FestivalCard key={f.id} festival={f} />
            ))}
          </div>
        </section>
      )}

      <section className="bg-gray-50 py-16">
        <div className="max-w-lg mx-auto px-4 text-center">
          <h2 className="text-2xl font-bold mb-2">
            Know a festival we&apos;re missing?
          </h2>
          <p className="text-gray-600 mb-4">
            Help us grow our database by submitting festivals.
          </p>
          <Link
            href="/submit"
            className="inline-block bg-black text-white px-6 py-3 rounded hover:bg-gray-800"
          >
            Submit a Festival
          </Link>
        </div>
      </section>
    </div>
  );
}
