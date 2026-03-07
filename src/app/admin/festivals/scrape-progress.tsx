"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ScrapeProgressProps {
  onComplete: (data: CrawlCompleteData) => void;
  onError: (message: string) => void;
  festivalId?: string;
  initialUrl?: string;
}

interface PageNode {
  url: string;
  path: string;
  title?: string;
  category?: "lineup" | "info" | "poster_only" | "irrelevant";
  children?: PageNode[];
}

interface ImageCandidate {
  src: string;
  alt: string;
  sourcePage: string;
  sourceClassification: "poster_only" | "lineup" | "fallback" | "og" | "favicon";
  width: number | null;
  height: number | null;
}

interface CrawlCompleteData {
  scrapeLogId: string;
  extraction: {
    festival_name: string;
    dates: { start: string; end: string };
    location: string;
    region: string;
    website_url: string;
    artists: Array<{ name: string; billing: "headliner" | "support" }>;
    lineup_pending?: boolean;
  };
  source: "text" | "poster" | "text+poster";
  lineupUrl: string | null;
  posterPageUrl: string | null;
  imageCandidates: ImageCandidate[];
  algorithmPosterSrc: string | null;
  lineupPending: boolean;
  logoImageUrl: string | null;
  usage: {
    totalCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costGbp: number;
  };
  pageTree: PageNode;
  pagesScraped: number;
  deepScrapeCandidate: { url: string; reason: string } | null;
}

const CATEGORY_STYLES: Record<
  string,
  { label: string; className: string }
> = {
  lineup: { label: "[L]", className: "text-green-600" },
  info: { label: "[I]", className: "text-blue-600" },
  poster_only: { label: "[P]", className: "text-purple-600" },
  irrelevant: { label: "[-]", className: "text-gray-400" },
  pending: { label: "[.]", className: "text-gray-300" },
};

function PageTreeNode({ node, depth = 0 }: { node: PageNode; depth?: number }) {
  const cat = node.category
    ? CATEGORY_STYLES[node.category]
    : CATEGORY_STYLES.pending;
  let displayName = node.title || node.path || node.url;
  try {
    if (!node.title && !node.path && node.url) {
      displayName = new URL(node.url).pathname;
    }
  } catch {
    // node.url is not a valid absolute URL — fall back to raw value
  }

  return (
    <>
      <div
        className="text-sm font-mono leading-relaxed"
        style={{ paddingLeft: `${depth * 16}px` }}
        title={node.url}
      >
        <span className={`font-bold ${cat.className}`}>{cat.label}</span>{" "}
        <span className="text-gray-700">{displayName}</span>
      </div>
      {node.children?.map((child, i) => (
        <PageTreeNode key={child.url || i} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function ScrapeProgress({
  onComplete,
  onError,
  festivalId,
  initialUrl,
}: ScrapeProgressProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [scraping, setScraping] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [pageTree, setPageTree] = useState<PageNode | null>(null);
  const [usage, setUsage] = useState<{
    totalCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev, message]);
  }, []);

  async function handleScrape() {
    if (!url.trim() || scraping) return;

    setScraping(true);
    setLogs([]);
    setPageTree(null);
    setUsage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/admin/scrape-festival", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), festivalId }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        let message = "Scraping failed";
        try {
          message = JSON.parse(text).error || message;
        } catch {
          // ignore parse error
        }
        addLog(`Error: ${message}`);
        onError(message);
        setScraping(false);
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
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
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
                addLog(data.message as string);
              }
              if (data.pageTree) {
                setPageTree(data.pageTree as PageNode);
              }
              if (data.usage) {
                setUsage(
                  data.usage as {
                    totalCalls: number;
                    inputTokens: number;
                    outputTokens: number;
                    costUsd: number;
                  }
                );
              }
            } else if (currentEvent === "complete") {
              addLog("Crawl complete.");
              onComplete(data as unknown as CrawlCompleteData);
            } else if (currentEvent === "error") {
              const msg = (data.message as string) || "Unknown error";
              addLog(`Error: ${msg}`);
              onError(msg);
            }

            currentEvent = "";
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        addLog("Scraping aborted.");
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error";
        addLog(`Error: ${msg}`);
        onError(msg);
      }
    } finally {
      setScraping(false);
      abortRef.current = null;
    }
  }

  const tokenCount = usage
    ? usage.inputTokens + usage.outputTokens
    : 0;

  return (
    <div className="space-y-4">
      {/* URL input + button */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label
            htmlFor="scrapeUrl"
            className="block text-sm font-medium text-gray-700"
          >
            Festival Website URL
          </label>
          <input
            id="scrapeUrl"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={scraping}
            placeholder="https://festival.com"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>
        <button
          type="button"
          onClick={handleScrape}
          disabled={scraping || !url.trim()}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {scraping ? "Scraping..." : "Scrape Festival"}
        </button>
      </div>

      {/* Progress log */}
      {logs.length > 0 && (
        <div className="bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-xs max-h-48 overflow-y-auto">
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Usage stats */}
      {usage && (
        <p className="text-xs text-gray-500">
          {usage.totalCalls} AI calls | {tokenCount.toLocaleString()} tokens |
          ${usage.costUsd.toFixed(4)}
        </p>
      )}

      {/* Page tree */}
      {pageTree && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <div className="flex gap-4 text-xs text-gray-500 mb-2 flex-wrap">
            <span>
              <span className="font-bold text-green-600">[L]</span> lineup
            </span>
            <span>
              <span className="font-bold text-blue-600">[I]</span> info
            </span>
            <span>
              <span className="font-bold text-purple-600">[P]</span> poster
            </span>
            <span>
              <span className="font-bold text-gray-400">[-]</span> irrelevant
            </span>
            <span>
              <span className="font-bold text-gray-300">[.]</span> pending
            </span>
          </div>
          <PageTreeNode node={pageTree} />
        </div>
      )}
    </div>
  );
}
