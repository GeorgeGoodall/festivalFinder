"use client";

import { useState } from "react";
import { ScrapeProgress } from "../scrape-progress";
import { saveScrapedArtists } from "@/lib/actions/scrape";

interface ScrapeSectionProps {
  festivalId: string;
  websiteUrl: string | null;
  lastScrapedAt: Date | null;
}

interface Artist {
  name: string;
  billing: "headliner" | "support";
}

export function ScrapeSection({ festivalId, websiteUrl, lastScrapedAt }: ScrapeSectionProps) {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  function updateArtist(index: number, field: keyof Artist, value: string) {
    const updated = [...artists];
    updated[index] = { ...updated[index], [field]: value };
    setArtists(updated);
  }

  function removeArtist(index: number) {
    setArtists(artists.filter((_, i) => i !== index));
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

  return (
    <div className="max-w-2xl mt-8">
      <h2 className="text-xl font-bold mb-4">Scrape from Website</h2>

      <div className="bg-white p-4 rounded-lg shadow space-y-4">
        <ScrapeProgress
          festivalId={festivalId}
          initialUrl={websiteUrl ?? undefined}
          onComplete={(data) => {
            setError(null);
            setDone(false);
            setArtists(data.extraction.artists || []);
          }}
          onError={(message) => {
            setError(message);
          }}
        />

        {lastScrapedAt && (
          <p className="text-xs text-gray-500">
            Last scraped: {new Date(lastScrapedAt).toLocaleString()}
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</p>
        )}

        {artists.length > 0 && (
          <div className="border rounded p-4 space-y-3">
            <h3 className="font-medium">
              Found {artists.length} artists — Review & Save
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
