"use client";

import { useState } from "react";
import { splitArtist } from "@/lib/actions/artist";

export function SplitArtistSection({
  artistId,
  parts,
  connector,
  dismissAction,
  collapsed,
}: {
  artistId: string;
  parts: string[];
  connector: string;
  dismissAction?: () => Promise<void>;
  collapsed?: boolean;
}) {
  const [names, setNames] = useState(parts);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function handleSplit() {
    if (names.some((n) => !n.trim())) return;
    if (
      !confirm(
        `Split into ${names.length} separate artists?\n\n${names.map((n) => `- ${n}`).join("\n")}\n\nEach will be added to the same festivals.`
      )
    )
      return;

    setIsPending(true);
    setError(null);
    try {
      await splitArtist(artistId, names);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to split artist");
      setIsPending(false);
    }
  }

  if (collapsed && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-gray-400 hover:text-gray-600 text-sm"
      >
        Split anyway...
      </button>
    );
  }

  if (collapsed && expanded) {
    return (
      <div className="max-w-2xl mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="space-y-2 mb-3">
          {names.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-5">{i + 1}.</span>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  const updated = [...names];
                  updated[i] = e.target.value;
                  setNames(updated);
                }}
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm bg-white"
              />
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSplit}
            disabled={isPending || names.some((n) => !n.trim())}
            className="bg-gray-600 text-white px-4 py-1.5 rounded text-sm hover:bg-gray-700 disabled:opacity-50"
          >
            {isPending ? "Splitting..." : "Split"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-amber-800 mb-1">
        Multiple artists detected
      </h3>
      <p className="text-sm text-amber-700 mb-3">
        This name contains &quot;{connector}&quot; &mdash; it may be two separate artists.
        You can split them so each is searchable individually.
      </p>

      <div className="space-y-2 mb-3">
        {names.map((name, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-amber-600 w-5">{i + 1}.</span>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                const updated = [...names];
                updated[i] = e.target.value;
                setNames(updated);
              }}
              className="flex-1 rounded border border-amber-300 px-3 py-1.5 text-sm bg-white"
            />
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSplit}
          disabled={isPending || names.some((n) => !n.trim())}
          className="bg-amber-600 text-white px-4 py-1.5 rounded text-sm hover:bg-amber-700 disabled:opacity-50"
        >
          {isPending ? "Splitting..." : "Split into separate artists"}
        </button>
        {dismissAction && (
          <form action={dismissAction}>
            <button
              type="submit"
              className="text-sm text-amber-600 hover:underline"
            >
              Not two artists &mdash; dismiss
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
