"use client";

import { useState } from "react";
import { createFestival } from "@/lib/actions/festival";
import { UK_REGIONS } from "@/lib/constants";
import { ScrapeProgress } from "../scrape-progress";
import { ImagePicker, type ImageCandidate } from "../image-picker";

interface Artist {
  name: string;
  billing: "headliner" | "support";
}

export function NewFestivalForm() {
  const [extracted, setExtracted] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Form field state for pre-filling
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [location, setLocation] = useState("");
  const [region, setRegion] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");

  // Fields from crawl result
  const [lineupUrl, setLineupUrl] = useState("");
  const [posterPageUrl, setPosterPageUrl] = useState<string | null>(null);
  const [lineupPending, setLineupPending] = useState(false);
  const [logoImageUrl, setLogoImageUrl] = useState<string | null>(null);
  const [imageCandidates, setImageCandidates] = useState<ImageCandidate[]>([]);
  const [algorithmPosterSrc, setAlgorithmPosterSrc] = useState<string | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [selectedPosterSrcs, setSelectedPosterSrcs] = useState<string[]>([]);
  const [selectedLogoSrc, setSelectedLogoSrc] = useState<string | null>(null);

  // Deep scrape state
  const [deepScrapeUrl, setDeepScrapeUrl] = useState("");
  const [deepScraping, setDeepScraping] = useState(false);
  const [deepLogs, setDeepLogs] = useState<string[]>([]);
  const [deepScrapeCandidate, setDeepScrapeCandidate] = useState<{ url: string; reason: string } | null>(null);

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

  async function handleDeepScrape() {
    if (!deepScrapeUrl.trim() || deepScraping) return;

    setDeepScraping(true);
    setDeepLogs([]);
    setError(null);

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
              setArtists((prev) => {
                const existingNames = new Set(prev.map((a) => a.name.toLowerCase()));
                const toAdd = foundArtists.filter(
                  (a) => !existingNames.has(a.name.toLowerCase())
                );
                return [...prev, ...toAdd];
              });
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
    <div>
      <h1 className="text-2xl font-bold mb-6">Add Festival</h1>

      {/* Step 1: Scrape from URL */}
      <div className="max-w-2xl bg-white p-6 rounded-lg shadow mb-6">
        <h2 className="text-lg font-bold mb-2">
          Step 1: Scrape from Website
        </h2>
        <p className="text-sm text-gray-700 mb-4">
          Enter a festival website URL and we&apos;ll crawl it to extract the
          name, dates, location, lineup, and poster automatically.
        </p>

        {error && (
          <p className="mb-4 text-sm text-red-700 bg-red-50 p-3 rounded">
            {error}
          </p>
        )}

        <ScrapeProgress
          onComplete={(data) => {
            setError(null);
            const ext = data.extraction;
            if (ext.festival_name) setName(ext.festival_name);
            if (ext.dates?.start) setStartDate(ext.dates.start);
            if (ext.dates?.end) setEndDate(ext.dates.end);
            if (ext.location) setLocation(ext.location);
            if (ext.region) setRegion(ext.region);
            if (ext.website_url) setWebsiteUrl(ext.website_url);
            if (ext.artists?.length) setArtists(ext.artists);
            setLineupUrl(data.lineupUrl ?? "");
            setPosterPageUrl(data.posterPageUrl);
            setLineupPending(data.lineupPending ?? false);
            setLogoImageUrl(data.logoImageUrl ?? null);
            setImageCandidates(data.imageCandidates);
            setAlgorithmPosterSrc(data.algorithmPosterSrc);
            // Pre-select algorithm picks
            if (data.algorithmPosterSrc) setSelectedPosterSrcs([data.algorithmPosterSrc]);
            setSelectedLogoSrc(data.logoImageUrl ?? null);
            if (data.deepScrapeCandidate) {
              setDeepScrapeCandidate(data.deepScrapeCandidate);
              setDeepScrapeUrl(data.deepScrapeCandidate.url);
            }
            setExtracted(true);
            setShowImagePicker(true);
            // DO NOT call setShowForm(true) here — the image picker's Continue button does that
          }}
          onError={(message) => {
            setError(message);
          }}
        />

        {/* Deep Scrape — only shown after initial scrape completes */}
        {extracted && (
          <div className="border-t pt-4 mt-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700">
              Deep Scrape (JS-heavy pages)
            </h3>
            {deepScrapeCandidate ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                ⚠ {deepScrapeCandidate.reason}
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Use for pages with &quot;Show More&quot; buttons that hide content
                behind JavaScript. Paste the specific page URL (e.g. the
                artists/lineup page).
              </p>
            )}
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
        )}

        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Skip &mdash; enter details manually
          </button>
        )}
      </div>

      {/* Step 1.5: Image picker — shown after scrape, before form */}
      {showImagePicker && !showForm && (
        <div className="max-w-4xl bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-lg font-bold mb-4">Step 1.5: Select Images</h2>
          <ImagePicker
            candidates={imageCandidates}
            algorithmPosterSrc={algorithmPosterSrc}
            algorithmLogoSrc={logoImageUrl}
            selectedPosterSrcs={selectedPosterSrcs}
            selectedLogoSrc={selectedLogoSrc}
            onPosterChange={setSelectedPosterSrcs}
            onLogoChange={setSelectedLogoSrc}
            onArtistsMerge={(newArtists) => {
              setArtists((prev) => {
                const existingNames = new Set(prev.map((a) => a.name.toLowerCase()));
                const toAdd = newArtists.filter(
                  (a) => !existingNames.has(a.name.toLowerCase())
                );
                return [...prev, ...toAdd];
              });
            }}
            onContinue={() => {
              setShowForm(true);
              setShowImagePicker(false);
            }}
          />
        </div>
      )}

      {/* Step 2: Form (pre-filled from extraction) */}
      {showForm && (
        <form
          action={createFestival}
          className="max-w-2xl space-y-6 bg-white p-6 rounded-lg shadow"
        >
          <h2 className="text-lg font-bold">Step 2: Festival Details</h2>

          {extracted && (
            <p className="text-sm text-green-700 font-medium">
              Extracted! Review the pre-filled form below.
            </p>
          )}

          {/* Hidden fields */}
          {posterPageUrl && (
            <input type="hidden" name="posterPageUrl" value={posterPageUrl} />
          )}
          {lineupUrl && (
            <input type="hidden" name="lineupUrl" value={lineupUrl} />
          )}
          <input type="hidden" name="lineupPending" value={String(lineupPending)} />
          {selectedPosterSrcs.length > 0 && (
            <input type="hidden" name="selectedPosterSrcs" value={JSON.stringify(selectedPosterSrcs)} />
          )}
          {selectedLogoSrc && (
            <input type="hidden" name="selectedLogoSrc" value={selectedLogoSrc} />
          )}
          {artists.length > 0 && (
            <input
              type="hidden"
              name="artists"
              value={JSON.stringify(artists)}
            />
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
                      onChange={(e) =>
                        updateArtist(i, "billing", e.target.value)
                      }
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

          <div className="flex gap-3">
            <button
              type="submit"
              className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
            >
              Create Festival
            </button>
            <button
              type="submit"
              name="publish"
              value="true"
              className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700"
            >
              Create &amp; Publish
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
