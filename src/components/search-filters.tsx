"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { UK_REGIONS } from "@/lib/constants";

export function SearchFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [artist, setArtist] = useState(searchParams.get("artist") || "");
  const [region, setRegion] = useState(searchParams.get("region") || "");
  const [dateFrom, setDateFrom] = useState(
    searchParams.get("dateFrom") || ""
  );
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") || "");
  const [priceMax, setPriceMax] = useState(
    searchParams.get("priceMax") || ""
  );
  const [camping, setCamping] = useState(
    searchParams.get("camping") === "true"
  );
  const [ageRestriction, setAgeRestriction] = useState(
    searchParams.get("ageRestriction") || ""
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (artist) params.set("artist", artist);
    if (region) params.set("region", region);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (priceMax) params.set("priceMax", priceMax);
    if (camping) params.set("camping", "true");
    if (ageRestriction) params.set("ageRestriction", ageRestriction);
    router.push(`/festivals?${params.toString()}`);
  }

  return (
    <form
      onSubmit={handleSearch}
      className="bg-white p-4 rounded-lg shadow space-y-4"
    >
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Search by artist(s)
        </label>
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="e.g. Arctic Monkeys, Dua Lipa"
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
        />
        <p className="text-xs text-gray-700 mt-1">
          Separate multiple artists with commas
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Region
          </label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          >
            <option value="">All regions</option>
            {UK_REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            From
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            To
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Max price
          </label>
          <input
            type="number"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            placeholder="£"
            min="0"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={camping}
            onChange={(e) => setCamping(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-sm text-gray-700">Camping only</span>
        </label>
        <select
          value={ageRestriction}
          onChange={(e) => setAgeRestriction(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All ages</option>
          <option value="family-friendly">Family-friendly</option>
          <option value="all ages">All ages only</option>
          <option value="18+">18+</option>
        </select>
        <button
          type="submit"
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
        >
          Search
        </button>
      </div>
    </form>
  );
}
