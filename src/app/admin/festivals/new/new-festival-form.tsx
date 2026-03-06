"use client";

import { useState } from "react";
import { createFestival } from "@/lib/actions/festival";
import { UK_REGIONS } from "@/lib/constants";

interface Artist {
  name: string;
  billing: "headliner" | "support";
}

interface ExtractionData {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  artists: Artist[];
}

export function NewFestivalForm() {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [artists, setArtists] = useState<Artist[]>([]);

  // Form field state for pre-filling
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [region, setRegion] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [lineupUrl, setLineupUrl] = useState("");
  const [scrapingUrl, setScrapingUrl] = useState(false);
  const [scrapeWarning, setScrapeWarning] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/admin/upload-poster", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (data.url) {
      setPosterUrl(data.url);
    }
    setUploading(false);
  }

  async function handleExtract() {
    if (!posterUrl) return;
    setExtracting(true);

    const res = await fetch("/api/admin/extract-poster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterUrl }),
    });

    const data = await res.json();
    if (data.extraction) {
      const ext = data.extraction as ExtractionData;
      if (ext.festival_name) setName(ext.festival_name);
      if (ext.dates?.start) setStartDate(ext.dates.start);
      if (ext.dates?.end) setEndDate(ext.dates.end);
      if (ext.location) setLocation(ext.location);
      if (ext.region) setRegion(ext.region);
      if (ext.website_url) setWebsiteUrl(ext.website_url);
      if (ext.artists?.length) setArtists(ext.artists);
      setExtracted(true);
    }
    setExtracting(false);
  }

  async function handleScrapeUrl() {
    if (!lineupUrl.trim()) return;
    setScrapingUrl(true);
    setScrapeWarning(null);

    try {
      const res = await fetch("/api/admin/scrape-lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: lineupUrl.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setScrapeWarning(data.error || "Scraping failed");
        setScrapingUrl(false);
        return;
      }

      if (!data.extraction.isLineupPage) {
        setScrapeWarning(
          data.extraction.rejectionReason || "This doesn't appear to be a lineup page."
        );
      }

      if (data.extraction.artists?.length) {
        setArtists(data.extraction.artists);
        setExtracted(true);
      }
    } catch {
      setScrapeWarning("Failed to scrape. Check the URL and try again.");
    } finally {
      setScrapingUrl(false);
    }
  }

  function updateArtist(index: number, field: keyof Artist, value: string) {
    const updated = [...artists];
    updated[index] = { ...updated[index], [field]: value };
    setArtists(updated);
  }

  function removeArtist(index: number) {
    setArtists(artists.filter((_, i) => i !== index));
  }

  function addArtist() {
    setArtists([...artists, { name: "", billing: "support" }]);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Add Festival</h1>

      {/* Step 1: Poster Upload */}
      <div className="max-w-2xl bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-lg font-bold mb-2">
          Step 1: Upload Poster (optional)
        </h2>
        <p className="text-sm text-gray-700 mb-4">
          Upload a festival poster and we'll extract the name, dates, location, and
          lineup automatically.
        </p>

        {posterUrl && (
          <img
            src={posterUrl}
            alt="Uploaded poster"
            className="w-full max-w-sm rounded mb-4"
          />
        )}

        <div className="space-y-3">
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={handleUpload}
              disabled={uploading}
            />
            {uploading && (
              <p className="text-sm text-gray-700 mt-1">Uploading...</p>
            )}
          </div>

          {posterUrl && !extracted && (
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {extracting
                ? "Extracting with AI..."
                : "Extract Details from Poster"}
            </button>
          )}

          {extracted && (
            <p className="text-sm text-green-700 font-medium">
              Extracted! Review the pre-filled form below.
            </p>
          )}
        </div>
      </div>

      {/* Step 1b: Scrape from URL */}
      <div className="max-w-2xl bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-lg font-bold mb-2">
          Or: Scrape Lineup from Website
        </h2>
        <p className="text-sm text-gray-700 mb-4">
          Paste a festival lineup page URL and we&apos;ll extract the artist names.
        </p>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <input
              type="url"
              value={lineupUrl}
              onChange={(e) => setLineupUrl(e.target.value)}
              placeholder="https://festival.com/lineup"
              className="block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <button
            type="button"
            onClick={handleScrapeUrl}
            disabled={scrapingUrl || !lineupUrl.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {scrapingUrl ? "Scraping..." : "Scrape Lineup"}
          </button>
        </div>

        {scrapeWarning && (
          <p className="mt-2 text-sm text-yellow-800 bg-yellow-50 p-3 rounded">
            {scrapeWarning}
          </p>
        )}
      </div>

      {/* Step 2: Form (pre-filled from extraction) */}
      <form
        action={createFestival}
        className="max-w-2xl space-y-6 bg-white p-6 rounded-lg shadow"
      >
        <h2 className="text-lg font-bold">Step 2: Festival Details</h2>

        {/* Hidden fields for poster and artists */}
        {posterUrl && (
          <input type="hidden" name="posterImageUrl" value={posterUrl} />
        )}
        {artists.length > 0 && (
          <input
            type="hidden"
            name="artists"
            value={JSON.stringify(artists)}
          />
        )}
        {lineupUrl && (
          <input type="hidden" name="lineupUrl" value={lineupUrl} />
        )}

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700"
          >
            Festival Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="startDate"
              className="block text-sm font-medium text-gray-700"
            >
              Start Date *
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label
              htmlFor="endDate"
              className="block text-sm font-medium text-gray-700"
            >
              End Date *
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="location"
              className="block text-sm font-medium text-gray-700"
            >
              Location *
            </label>
            <input
              id="location"
              name="location"
              type="text"
              required
              placeholder="e.g. Worthy Farm, Pilton, Somerset"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label
              htmlFor="region"
              className="block text-sm font-medium text-gray-700"
            >
              Region *
            </label>
            <select
              id="region"
              name="region"
              required
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select region...</option>
              {UK_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="priceFrom"
              className="block text-sm font-medium text-gray-700"
            >
              Price From
            </label>
            <input
              id="priceFrom"
              name="priceFrom"
              type="number"
              min="0"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label
              htmlFor="priceTo"
              className="block text-sm font-medium text-gray-700"
            >
              Price To
            </label>
            <input
              id="priceTo"
              name="priceTo"
              type="number"
              min="0"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="hasCamping"
            name="hasCamping"
            type="checkbox"
            className="rounded border-gray-300"
          />
          <label
            htmlFor="hasCamping"
            className="text-sm font-medium text-gray-700"
          >
            Has Camping
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="websiteUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Website URL
            </label>
            <input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label
              htmlFor="ticketUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Ticket URL
            </label>
            <input
              id="ticketUrl"
              name="ticketUrl"
              type="url"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        {/* Artists section */}
        {artists.length > 0 && (
          <div className="border rounded p-4">
            <h3 className="font-medium mb-3">
              Lineup ({artists.length} artists) - Review & Edit
            </h3>
            <div className="space-y-2">
              {artists.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.name}
                    onChange={(e) => updateArtist(i, "name", e.target.value)}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    placeholder="Artist name"
                  />
                  <select
                    value={a.billing}
                    onChange={(e) => updateArtist(i, "billing", e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="headliner">Headliner</option>
                    <option value="support">Support</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeArtist(i)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addArtist}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800"
            >
              + Add artist
            </button>
          </div>
        )}

        {artists.length === 0 && (
          <button
            type="button"
            onClick={addArtist}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            + Add artists manually
          </button>
        )}

        <button
          type="submit"
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
        >
          Create Festival
        </button>
      </form>
    </div>
  );
}
