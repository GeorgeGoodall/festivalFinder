import Link from "next/link";

interface FestivalCardProps {
  festival: {
    slug: string;
    name: string;
    startDate: Date;
    endDate: Date;
    location: string;
    region: string;
    priceFrom: number | null;
    priceTo: number | null;
    hasCamping: boolean;
    ageRestriction: string | null;
    posters: Array<{ imageUrl: string }>;
    artists: Array<{
      billing: string;
      artist: { name: string };
    }>;
  };
}

export function FestivalCard({ festival }: FestivalCardProps) {
  const headliners = festival.artists
    .filter((a) => a.billing === "headliner")
    .map((a) => a.artist.name);
  const otherArtists = festival.artists
    .filter((a) => a.billing !== "headliner")
    .map((a) => a.artist.name);

  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <Link href={`/festivals/${festival.slug}`} className="block group">
      <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden">
        {festival.posters[0]?.imageUrl ? (
          <img
            src={festival.posters[0].imageUrl}
            alt={festival.name}
            className="w-full h-48 object-cover"
          />
        ) : (
          <div className="w-full h-48 bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <span className="text-white text-lg font-bold">
              {festival.name}
            </span>
          </div>
        )}
        <div className="p-4">
          <h3 className="font-bold text-lg group-hover:text-blue-600 transition-colors">
            {festival.name}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {formatDate(festival.startDate)} - {formatDate(festival.endDate)}
          </p>
          <p className="text-sm text-gray-600">
            {festival.location}, {festival.region}
          </p>
          <div className="mt-2 flex gap-2 flex-wrap">
            {festival.priceFrom != null && (
              <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                From &pound;{festival.priceFrom}
              </span>
            )}
            {festival.hasCamping && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                Camping
              </span>
            )}
            {festival.ageRestriction && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                {festival.ageRestriction}
              </span>
            )}
          </div>
          {headliners.length > 0 && (
            <p className="text-sm mt-2 text-gray-600">
              <span className="font-medium">{headliners.join(", ")}</span>
              {otherArtists.length > 0 && (
                <span className="text-gray-600">
                  {" "}
                  +{otherArtists.length} more
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
