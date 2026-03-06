export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { searchFestivals, SearchParams } from "@/lib/queries";
import { FestivalCard } from "@/components/festival-card";
import { SearchFilters } from "@/components/search-filters";

export const metadata = {
  title: "Find Festivals | Festival Finder",
  description:
    "Search UK music festivals by artist, date, location, and more.",
};

export default async function FestivalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const festivals = await searchFestivals(params);
  const hasFilters = Object.values(params).some((v) => v);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Find Festivals</h1>
      <Suspense>
        <SearchFilters />
      </Suspense>
      <div className="mt-8">
        {hasFilters && (
          <p className="text-sm text-gray-500 mb-4">
            {festivals.length} festival{festivals.length !== 1 ? "s" : ""} found
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {festivals.map((f) => (
            <FestivalCard key={f.id} festival={f} />
          ))}
        </div>
        {festivals.length === 0 && hasFilters && (
          <p className="text-center text-gray-400 py-12">
            No festivals match your search. Try adjusting your filters.
          </p>
        )}
      </div>
    </div>
  );
}
