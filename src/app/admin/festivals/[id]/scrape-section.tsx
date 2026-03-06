"use client";

import { useState } from "react";
import { saveScrapedArtists } from "@/lib/actions/scrape";

interface ScrapeSectionProps {
  festivalId: string;
  lineupUrl: string | null;
  lastScrapedAt: Date | null;
}

interface Artist {
  name: string;
  billing: "headliner" | "support";
}

export function ScrapeSection({ festivalId, lineupUrl, lastScrapedAt }: ScrapeSectionProps) {
  const [url, setUrl] = useState(lineupUrl ?? "");
  const [scraping, setScraping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleScrape(forceExtract = false) {
    if (!url.trim()) return;
    setScraping(true);
    setWarning(null);
    setError(null);
    setArtists([]);
    setDone(false);

    try {
      const res = await fetch("/api/admin/scrape-lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), festivalId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Scraping failed");
        return;
      }

      if (!data.extraction.isLineupPage && !forceExtract) {
        setWarning(
          data.extraction.rejectionReason ||
            "This doesn't appear to be a lineup page."
        );
        if (data.extraction.artists?.length) {
          setArtists(data.extraction.artists);
        }
        return;
      }

      setArtists(data.extraction.artists || []);
    } catch {
      setError("Failed to scrape. Check the URL and try again.");
    } finally {
      setScraping(false);
    }
  }

  async function handleSave() {
    if (artists.length === 0) return;
    setSaving(true);
    try {
      await saveScrapedArtists(festivalId, artists);
      setDone(true);
      setArtists([]);
    } catch {
      setError("Failed to save artists.");
    } finally {
      setSaving(false);
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

  return (
    <div className="max-w-2xl mt-8">
      <h2 className="text-xl font-bold mb-4">Scrape Lineup from Website</h2>

      <div className="bg-white p-4 rounded-lg shadow space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="lineupUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Lineup Page URL
            </label>
            <input
              id="lineupUrl"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://festival.com/lineup"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <button
            type="button"
            onClick={() => handleScrape()}
            disabled={scraping || !url.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {scraping ? "Scraping..." : "Scrape Lineup"}
          </button>
        </div>

        {lastScrapedAt && (
          <p className="text-xs text-gray-500">
            Last scraped: {new Date(lastScrapedAt).toLocaleString()}
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>
        )}

        {warning && (
          <div className="bg-yellow-50 p-3 rounded space-y-2">
            <p className="text-sm text-yellow-800">{warning}</p>
            <button
              type="button"
              onClick={() => handleScrape(true)}
              className="text-sm text-yellow-700 underline hover:text-yellow-900"
            >
              Extract anyway
            </button>
          </div>
        )}

        {artists.length > 0 && (
          <div className="border rounded p-4 space-y-3">
            <h3 className="font-medium">
              Found {artists.length} artists - Review & Save
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {artists.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.name}
                    onChange={(e) => updateArtist(i, "name", e.target.value)}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
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
              onClick={handleSave}
              disabled={saving}
              className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Artists to Festival"}
            </button>
          </div>
        )}

        {done && (
          <p className="text-sm text-green-700 font-medium">
            Artists saved! Refresh the page to see the updated lineup.
          </p>
        )}
      </div>
    </div>
  );
}
