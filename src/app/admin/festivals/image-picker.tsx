"use client";

import { useState, useCallback } from "react";

export interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
}

interface ScrapeState {
  loading: boolean;
  done: boolean;
  artistCount: number;
  error: string | null;
}

interface ImagePickerProps {
  candidates: ImageCandidate[];
  algorithmPosterSrc: string | null;
  algorithmLogoSrc: string | null;
  selectedPosterSrcs: string[];
  selectedLogoSrc: string | null;
  onPosterChange: (srcs: string[]) => void;
  onLogoChange: (src: string | null) => void;
  onArtistsMerge: (artists: Array<{ name: string; billing: "headliner" | "support" }>) => void;
  onContinue: () => void;
}

function ImageCard({
  candidate,
  selectionControl,
  isAlgoPick,
  onScrape,
  scrapeState,
}: {
  candidate: ImageCandidate;
  selectionControl: React.ReactNode;
  isAlgoPick: boolean;
  onScrape?: () => void;
  scrapeState?: ScrapeState;
}) {
  const sourceLabel = (() => {
    try { return new URL(candidate.sourcePage).pathname || "/"; } catch { return candidate.sourcePage; }
  })();

  return (
    <div
      className={`relative border-2 rounded-lg overflow-hidden flex flex-col ${
        isAlgoPick ? "border-blue-500" : "border-gray-200"
      }`}
    >
      {isAlgoPick && (
        <span className="absolute top-1 left-1 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded z-10">
          AI pick
        </span>
      )}
      <div className="absolute top-1 right-1 z-10">{selectionControl}</div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={candidate.src}
        alt={candidate.alt || "candidate"}
        className="w-full h-32 object-cover bg-gray-100"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />

      <div className="p-2 text-xs text-gray-500 flex flex-col gap-1 flex-1">
        <span className="truncate" title={candidate.sourcePage}>{sourceLabel}</span>
        {candidate.width !== null && candidate.height !== null && (
          <span>{candidate.width}×{candidate.height}</span>
        )}
        <span className="capitalize text-gray-400">{candidate.sourceClassification.replace("_", " ")}</span>
      </div>

      {onScrape && (
        <div className="px-2 pb-2">
          {scrapeState?.done ? (
            <span className="text-xs text-green-700 font-medium">
              ✓ Scraped ({scrapeState.artistCount} artists)
            </span>
          ) : scrapeState?.error ? (
            <span className="text-xs text-red-600">{scrapeState.error}</span>
          ) : (
            <button
              type="button"
              onClick={onScrape}
              disabled={scrapeState?.loading}
              className="w-full text-xs bg-gray-800 text-white rounded px-2 py-1 hover:bg-black disabled:opacity-50"
            >
              {scrapeState?.loading ? "Scraping..." : "Scrape"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ImagePicker({
  candidates,
  algorithmPosterSrc,
  algorithmLogoSrc,
  selectedPosterSrcs,
  selectedLogoSrc,
  onPosterChange,
  onLogoChange,
  onArtistsMerge,
  onContinue,
}: ImagePickerProps) {
  const [scrapeStates, setScrapeStates] = useState<Map<string, ScrapeState>>(new Map());

  // Deduplicate by src (same image may appear from multiple pages)
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((c) => {
    if (seen.has(c.src)) return false;
    seen.add(c.src);
    return true;
  });

  // Exclude favicons from lineup section
  const lineupCandidates = uniqueCandidates.filter(
    (c) => c.sourceClassification !== "favicon"
  );
  // Logo section: all candidates including favicon
  const logoCandidates = uniqueCandidates;

  const handleScrape = useCallback(
    async (src: string) => {
      setScrapeStates((prev) =>
        new Map(prev).set(src, { loading: true, done: false, artistCount: 0, error: null })
      );
      try {
        const res = await fetch("/api/admin/extract-poster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ posterUrl: src }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Extraction failed");
        const artists = data.extraction?.artists ?? [];
        onArtistsMerge(artists);
        setScrapeStates((prev) =>
          new Map(prev).set(src, { loading: false, done: true, artistCount: artists.length, error: null })
        );
      } catch (err) {
        setScrapeStates((prev) =>
          new Map(prev).set(src, {
            loading: false,
            done: false,
            artistCount: 0,
            error: err instanceof Error ? err.message : "Failed",
          })
        );
      }
    },
    [onArtistsMerge]
  );

  function togglePoster(src: string) {
    if (selectedPosterSrcs.includes(src)) {
      onPosterChange(selectedPosterSrcs.filter((s) => s !== src));
    } else {
      onPosterChange([...selectedPosterSrcs, src]);
    }
  }

  return (
    <div className="space-y-8">
      {/* Lineup Poster(s) */}
      <div>
        <h3 className="text-base font-semibold mb-1">Lineup Poster(s)</h3>
        <p className="text-sm text-gray-500 mb-3">
          Select one or more images to use as the festival lineup poster. Use &quot;Scrape&quot; to extract artists from a poster image.
        </p>
        {lineupCandidates.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No images found during crawl.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {lineupCandidates.map((c) => {
              const selected = selectedPosterSrcs.includes(c.src);
              return (
                <ImageCard
                  key={c.src}
                  candidate={c}
                  isAlgoPick={c.src === algorithmPosterSrc}
                  scrapeState={scrapeStates.get(c.src)}
                  onScrape={() => handleScrape(c.src)}
                  selectionControl={
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePoster(c.src)}
                      className="w-4 h-4 accent-blue-600"
                      aria-label="Select as lineup poster"
                    />
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Festival Logo */}
      <div>
        <h3 className="text-base font-semibold mb-1">Festival Logo</h3>
        <p className="text-sm text-gray-500 mb-3">
          Select one image to use as the festival logo.
        </p>
        {logoCandidates.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No images found during crawl.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {logoCandidates.map((c) => (
              <ImageCard
                key={c.src}
                candidate={c}
                isAlgoPick={c.src === algorithmLogoSrc}
                selectionControl={
                  <input
                    type="radio"
                    name="logo-pick"
                    checked={selectedLogoSrc === c.src}
                    onChange={() => onLogoChange(c.src)}
                    className="w-4 h-4 accent-blue-600"
                    aria-label="Select as logo"
                  />
                }
              />
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
      >
        Continue to Festival Details →
      </button>
    </div>
  );
}
