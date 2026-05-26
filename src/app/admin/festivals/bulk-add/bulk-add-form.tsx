"use client";

import { useState, useRef } from "react";
import { ImagePicker, type ImageCandidate } from "../image-picker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewData {
  extraction: {
    festival_name: string;
    dates: { start: string; end: string };
    location: string;
    region: string;
    website_url: string;
    artists: Array<{ name: string; billing: "headliner" | "support" }>;
    lineup_pending?: boolean;
  };
  imageCandidates: ImageCandidate[];
  algorithmPosterSrc: string | null;
  lineupUrl: string | null;
  posterPageUrl: string | null;
  lineupPending: boolean;
  logoImageUrl: string | null;
  source: string;
  pagesScraped: number;
  deepScrapeCandidate: { url: string; reason: string } | null;
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
}

type ItemStatus =
  | { phase: "pending" }
  | { phase: "scraping"; logs: string[] }
  | { phase: "saved"; festivalId: string; festivalName: string; artistCount: number }
  | { phase: "lineup_pending"; festivalName: string }
  | { phase: "needs_review"; data: ReviewData }
  | { phase: "saving" }
  | { phase: "error"; message: string };

interface QueueItem {
  url: string;
  status: ItemStatus;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BulkAddForm() {
  const [urlText, setUrlText] = useState("");
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [running, setRunning] = useState(false);
  // Maps queue index -> selected poster src for review items
  const [reviewSelections, setReviewSelections] = useState<Record<number, string | null>>({});

  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Helpers to immutably update queue state
  // ---------------------------------------------------------------------------

  function updateItemStatus(index: number, status: ItemStatus) {
    setQueue((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], status };
      return next;
    });
  }

  function appendLog(index: number, message: string) {
    setQueue((prev) => {
      if (!prev) return prev;
      const item = prev[index];
      if (item.status.phase !== "scraping") return prev;
      const next = [...prev];
      next[index] = {
        ...item,
        status: { phase: "scraping", logs: [...item.status.logs, message] },
      };
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Core queue runner
  // ---------------------------------------------------------------------------

  async function runQueue(items: QueueItem[]) {
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    for (let i = 0; i < items.length; i++) {
      if (controller.signal.aborted) break;

      updateItemStatus(i, { phase: "scraping", logs: [] });

      try {
        const res = await fetch("/api/admin/bulk-scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: items[i].url }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text();
          let message = "Scraping failed";
          try {
            message = (JSON.parse(text) as { error?: string }).error || message;
          } catch {
            // ignore parse error
          }
          updateItemStatus(i, { phase: "error", message });
          continue;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (controller.signal.aborted) break outer;
            const trimmed = line.trim();

            if (trimmed.startsWith("event: ")) {
              currentEvent = trimmed.slice(7).trim();
              continue;
            }

            if (trimmed.startsWith("data: ")) {
              const raw = trimmed.slice(6);
              let data: Record<string, unknown>;
              try {
                data = JSON.parse(raw);
              } catch {
                continue;
              }

              if (currentEvent === "progress") {
                if (data.message) {
                  appendLog(i, data.message as string);
                }
              } else if (currentEvent === "complete") {
                if (data.autoSaved === true) {
                  if (data.lineupPending) {
                    updateItemStatus(i, {
                      phase: "lineup_pending",
                      festivalName: data.festivalName as string,
                    });
                  } else {
                    updateItemStatus(i, {
                      phase: "saved",
                      festivalId: data.festivalId as string,
                      festivalName: data.festivalName as string,
                      artistCount: data.artistCount as number,
                    });
                  }
                } else {
                  // needs_review — stash the full data payload
                  const reviewData = data as unknown as ReviewData;
                  updateItemStatus(i, { phase: "needs_review", data: reviewData });
                  // Pre-select algorithm poster
                  setReviewSelections((prev) => ({
                    ...prev,
                    [i]: reviewData.algorithmPosterSrc ?? null,
                  }));
                }
              } else if (currentEvent === "error") {
                const message = (data.message as string) || "Unknown error";
                updateItemStatus(i, { phase: "error", message });
              }

              currentEvent = "";
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          updateItemStatus(i, { phase: "error", message: "Aborted" });
          break;
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        updateItemStatus(i, { phase: "error", message });
      }
    }

    abortRef.current = null;
    setRunning(false);
  }

  // ---------------------------------------------------------------------------
  // Review save handler
  // ---------------------------------------------------------------------------

  async function handleSaveReview(index: number, data: ReviewData) {
    updateItemStatus(index, { phase: "saving" });

    try {
      const res = await fetch("/api/admin/bulk-save-festival", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crawlResult: data,
          selectedPosterSrc: reviewSelections[index] ?? null,
        }),
      });

      const json = await res.json() as { festivalId?: string; festivalName?: string; artistCount?: number; error?: string };

      if (!res.ok) {
        throw new Error(json.error || "Save failed");
      }

      updateItemStatus(index, {
        phase: "saved",
        festivalId: json.festivalId!,
        festivalName: json.festivalName!,
        artistCount: json.artistCount ?? 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      updateItemStatus(index, { phase: "error", message });
    }
  }

  // ---------------------------------------------------------------------------
  // Start handler
  // ---------------------------------------------------------------------------

  function handleStart() {
    const urls = urlText
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http"));

    if (urls.length === 0) return;

    const items: QueueItem[] = urls.map((url) => ({
      url,
      status: { phase: "pending" },
    }));

    setQueue(items);
    setReviewSelections({});
    void runQueue(items);
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleStartOver() {
    abortRef.current?.abort();
    setQueue(null);
    setRunning(false);
    setReviewSelections({});
  }

  // ---------------------------------------------------------------------------
  // Derived counts for summary bar
  // ---------------------------------------------------------------------------

  const savedCount = queue?.filter(
    (item) => item.status.phase === "saved" || item.status.phase === "lineup_pending"
  ).length ?? 0;
  const needsReviewCount = queue?.filter(
    (item) => item.status.phase === "needs_review" || item.status.phase === "saving"
  ).length ?? 0;
  const errorCount = queue?.filter((item) => item.status.phase === "error").length ?? 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Before queue starts — show input textarea
  if (queue === null) {
    return (
      <div className="space-y-4">
        <textarea
          rows={10}
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          placeholder={"https://festival-one.co.uk\nhttps://festival-two.com\nhttps://festival-three.co.uk"}
          className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
        />
        <button
          type="button"
          onClick={handleStart}
          disabled={!urlText.split("\n").some((u) => u.trim().startsWith("http"))}
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
        >
          Start Bulk Add
        </button>
      </div>
    );
  }

  // After queue starts — show progress
  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm">
        <span className="font-medium">{queue.length} URLs</span>
        <span className="text-green-700">{savedCount} saved</span>
        {needsReviewCount > 0 && (
          <span className="text-amber-700">{needsReviewCount} needs review</span>
        )}
        {errorCount > 0 && (
          <span className="text-red-700">{errorCount} errors</span>
        )}
        <div className="ml-auto flex gap-2">
          {running ? (
            <button
              type="button"
              onClick={handleStop}
              className="bg-red-600 text-white px-3 py-1.5 rounded text-xs hover:bg-red-700"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartOver}
              className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs hover:bg-gray-300"
            >
              Start over
            </button>
          )}
        </div>
      </div>

      {/* Queue item rows */}
      <div className="space-y-3">
        {queue.map((item, i) => (
          <QueueRow
            key={item.url + i}
            item={item}
            index={i}
            reviewSelection={reviewSelections[i] ?? null}
            onReviewSelectionChange={(src) =>
              setReviewSelections((prev) => ({ ...prev, [i]: src }))
            }
            onSaveReview={(data) => handleSaveReview(i, data)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue row sub-component
// ---------------------------------------------------------------------------

interface QueueRowProps {
  item: QueueItem;
  index: number;
  reviewSelection: string | null;
  onReviewSelectionChange: (src: string | null) => void;
  onSaveReview: (data: ReviewData) => void;
}

function QueueRow({
  item,
  reviewSelection,
  onReviewSelectionChange,
  onSaveReview,
}: QueueRowProps) {
  const { url, status } = item;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Row header: URL + status badge */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white">
        <span className="font-mono text-xs text-gray-600 flex-1 truncate" title={url}>
          {url}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* Detail area depending on phase */}
      {status.phase === "scraping" && status.logs.length > 0 && (
        <div className="bg-gray-900 text-gray-100 px-3 py-2 font-mono text-xs max-h-40 overflow-y-auto">
          {status.logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      {status.phase === "saved" && (
        <div className="px-4 py-2 bg-green-50 text-sm flex items-center gap-3">
          <span className="font-medium text-green-800">{status.festivalName}</span>
          <span className="text-green-600 text-xs">{status.artistCount} artists</span>
          <a
            href={`/admin/festivals/${status.festivalId}`}
            className="ml-auto text-blue-600 hover:underline text-xs"
          >
            View →
          </a>
        </div>
      )}

      {status.phase === "lineup_pending" && (
        <div className="px-4 py-2 bg-yellow-50 text-sm flex items-center gap-2">
          <span className="font-medium text-yellow-800">{status.festivalName}</span>
          <span className="text-yellow-600 text-xs">lineup not yet announced</span>
        </div>
      )}

      {status.phase === "saving" && (
        <div className="px-4 py-2 bg-gray-50 text-sm text-gray-500">
          Saving...
        </div>
      )}

      {status.phase === "error" && (
        <div className="px-4 py-2 bg-red-50 text-sm text-red-700">
          {status.message}
        </div>
      )}

      {status.phase === "needs_review" && (
        <div className="p-4 bg-amber-50 space-y-3">
          {/* Festival name + date preview */}
          <div className="text-sm">
            <span className="font-semibold text-gray-800">
              {status.data.extraction.festival_name || "Unnamed festival"}
            </span>
            {status.data.extraction.dates?.start && (
              <span className="ml-2 text-gray-500">
                {status.data.extraction.dates.start}
                {status.data.extraction.dates.end &&
                  status.data.extraction.dates.end !== status.data.extraction.dates.start
                  ? ` – ${status.data.extraction.dates.end}`
                  : ""}
              </span>
            )}
            {status.data.extraction.location && (
              <span className="ml-2 text-gray-500">· {status.data.extraction.location}</span>
            )}
          </div>

          <ImagePicker
            candidates={status.data.imageCandidates}
            algorithmPosterSrc={status.data.algorithmPosterSrc}
            algorithmLogoSrc={status.data.logoImageUrl}
            selectedPosterSrcs={reviewSelection ? [reviewSelection] : []}
            selectedLogoSrc={status.data.logoImageUrl}
            onPosterChange={(srcs) => onReviewSelectionChange(srcs[0] ?? null)}
            onLogoChange={() => {}}
            onArtistsMerge={() => {}}
            onContinue={() => onSaveReview(status.data)}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ItemStatus }) {
  switch (status.phase) {
    case "pending":
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
          Pending
        </span>
      );
    case "scraping":
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-700 animate-pulse">
          Scraping…
        </span>
      );
    case "saved":
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-700">
          Saved
        </span>
      );
    case "lineup_pending":
      return (
        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs text-yellow-700">
          Lineup pending
        </span>
      );
    case "needs_review":
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs text-amber-700">
          Needs review
        </span>
      );
    case "saving":
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs text-blue-700 animate-pulse">
          Saving…
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs text-red-700">
          Error
        </span>
      );
  }
}
