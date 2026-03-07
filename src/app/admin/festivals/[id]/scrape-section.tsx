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
  const [scrapeLogId, setScrapeLogId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Deep scrape state
  const [deepScrapeUrl, setDeepScrapeUrl] = useState("");
  const [deepScraping, setDeepScraping] = useState(false);
  const [deepLogs, setDeepLogs] = useState<string[]>([]);

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
      await saveScrapedArtists(festivalId, artists, scrapeLogId ?? undefined);
      setDone(true);
      setArtists([]);
    } catch {
      setError("Failed to save artists.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeepScrape() {
    if (!deepScrapeUrl.trim() || deepScraping) return;

    setDeepScraping(true);
    setDeepLogs([]);
    setError(null);
    setDone(false);

    try {
      const res = await fetch("/api/admin/deep-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: deepScrapeUrl.trim() }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        let message = "Deep scrape failed";
        try {
          message = JSON.parse(text).error || message;
        } catch {
          // ignore
        }
        setError(message);
        setDeepScraping(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7).trim();
            continue;
          }
          if (trimmed.startsWith("data: ")) {
            let data: Record<string, unknown>;
            try {
              data = JSON.parse(trimmed.slice(6));
            } catch {
              continue;
            }

            if (currentEvent === "progress" && data.message) {
              setDeepLogs((prev) => [...prev, data.message as string]);
            } else if (currentEvent === "complete") {
              setDeepLogs((prev) => [...prev, "Deep scrape complete."]);
              const foundArtists = (data.artists as Artist[]) || [];
              setArtists(foundArtists);
            } else if (currentEvent === "error") {
              setError((data.message as string) || "Deep scrape failed");
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deep scrape failed");
    } finally {
      setDeepScraping(false);
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
            setScrapeLogId(data.scrapeLogId);
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

        {/* Deep Scrape */}
        <div className="border-t pt-4 mt-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Deep Scrape (JS-heavy pages)
          </h3>
          <p className="text-xs text-gray-500">
            Use for pages with &quot;Show More&quot; buttons that hide content
            behind JavaScript. Paste the specific page URL (e.g. the
            artists/lineup page).
          </p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <input
                type="url"
                value={deepScrapeUrl}
                onChange={(e) => setDeepScrapeUrl(e.target.value)}
                disabled={deepScraping}
                placeholder="https://festival.com/artists"
                className="block w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <button
              type="button"
              onClick={handleDeepScrape}
              disabled={deepScraping || !deepScrapeUrl.trim()}
              className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
            >
              {deepScraping ? "Deep Scraping..." : "Deep Scrape"}
            </button>
          </div>

          {deepLogs.length > 0 && (
            <div className="bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-xs max-h-36 overflow-y-auto">
              {deepLogs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>

        {done && (
          <p className="text-sm text-green-700 font-medium">
            Artists saved! Refresh the page to see the updated lineup.
          </p>
        )}
      </div>
    </div>
  );
}
