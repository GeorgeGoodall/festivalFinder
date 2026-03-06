import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const festival = await prisma.festival.findUnique({ where: { slug } });
  if (!festival) return {};
  return {
    title: `${festival.name} | Festival Finder`,
    description: `${festival.name} - ${festival.city}, ${festival.region}. Find lineup, dates, prices and more.`,
  };
}

export default async function FestivalPage({ params }: Props) {
  const { slug } = await params;
  const festival = await prisma.festival.findUnique({
    where: { slug, status: "published" },
    include: {
      artists: {
        include: { artist: true },
        orderBy: { billing: "asc" },
      },
    },
  });

  if (!festival) notFound();

  const headliners = festival.artists.filter((a) => a.billing === "headliner");
  const support = festival.artists.filter((a) => a.billing === "support");
  const other = festival.artists.filter((a) => a.billing === "other");

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="grid md:grid-cols-2 gap-8">
        <div>
          {festival.posterImageUrl ? (
            <img
              src={festival.posterImageUrl}
              alt={`${festival.name} poster`}
              className="w-full rounded-lg shadow"
            />
          ) : (
            <div className="w-full aspect-[3/4] bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <span className="text-white text-2xl font-bold">
                {festival.name}
              </span>
            </div>
          )}
        </div>

        <div>
          <h1 className="text-3xl font-bold">{festival.name}</h1>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-sm text-gray-500">Dates</p>
              <p>
                {formatDate(festival.startDate)} -{" "}
                {formatDate(festival.endDate)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Location</p>
              <p>
                {festival.venue && `${festival.venue}, `}
                {festival.city}, {festival.region}
              </p>
            </div>
            {(festival.priceFrom != null || festival.priceTo != null) && (
              <div>
                <p className="text-sm text-gray-500">Price</p>
                <p>
                  {festival.priceFrom != null &&
                    `From \u00A3${festival.priceFrom}`}
                  {festival.priceFrom != null &&
                    festival.priceTo != null &&
                    " - "}
                  {festival.priceTo != null && `\u00A3${festival.priceTo}`}
                </p>
              </div>
            )}
            <div>
              <p className="text-sm text-gray-500">Camping</p>
              <p>{festival.hasCamping ? "Yes" : "No"}</p>
            </div>
          </div>
          {festival.description && (
            <p className="mt-4 text-gray-700">{festival.description}</p>
          )}
          <div className="mt-6 flex gap-3">
            {festival.websiteUrl && (
              <a
                href={festival.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
              >
                Visit Website
              </a>
            )}
            {festival.ticketUrl && (
              <a
                href={festival.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
              >
                Buy Tickets
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="mt-12">
        <h2 className="text-2xl font-bold mb-6">Lineup</h2>
        {headliners.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Headliners
            </h3>
            <div className="flex flex-wrap gap-2">
              {headliners.map((a) => (
                <span
                  key={a.artistId}
                  className="bg-black text-white px-4 py-2 rounded-full text-lg font-medium"
                >
                  {a.artist.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {support.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Support
            </h3>
            <div className="flex flex-wrap gap-2">
              {support.map((a) => (
                <span
                  key={a.artistId}
                  className="bg-gray-200 px-3 py-1 rounded-full"
                >
                  {a.artist.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {other.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Also Playing
            </h3>
            <div className="flex flex-wrap gap-2">
              {other.map((a) => (
                <span
                  key={a.artistId}
                  className="bg-gray-100 px-3 py-1 rounded-full text-sm"
                >
                  {a.artist.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {festival.artists.length === 0 && (
          <p className="text-gray-400">Lineup not yet announced.</p>
        )}
      </div>
    </div>
  );
}
