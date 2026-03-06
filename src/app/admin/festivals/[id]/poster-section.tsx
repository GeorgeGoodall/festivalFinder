"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Artist {
  name: string;
  billing: "headliner" | "support" | "other";
}

export function PosterSection({
  festivalId,
  currentPosterUrl,
}: {
  festivalId: string;
  currentPosterUrl: string | null;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extraction, setExtraction] = useState<{ artists: Artist[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [posterUrl, setPosterUrl] = useState(currentPosterUrl);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("festivalId", festivalId);

    const res = await fetch("/api/admin/upload-poster", { method: "POST", body: formData });
    const data = await res.json();
    setPosterUrl(data.url);
    setUploading(false);
    router.refresh();
  }

  async function handleExtract() {
    if (!posterUrl) return;
    setExtracting(true);

    const res = await fetch("/api/admin/extract-poster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ festivalId, posterUrl }),
    });

    const data = await res.json();
    setExtraction(data.extraction);
    setExtracting(false);
  }

  async function handleApplyArtists() {
    if (!extraction) return;
    setSaving(true);

    await fetch("/api/admin/extract-poster", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ festivalId, artists: extraction.artists }),
    });

    setSaving(false);
    setExtraction(null);
    router.refresh();
  }

  function updateArtist(index: number, field: keyof Artist, value: string) {
    if (!extraction) return;
    const updated = [...extraction.artists];
    updated[index] = { ...updated[index], [field]: value };
    setExtraction({ ...extraction, artists: updated });
  }

  function removeArtist(index: number) {
    if (!extraction) return;
    const updated = extraction.artists.filter((_, i) => i !== index);
    setExtraction({ ...extraction, artists: updated });
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow max-w-2xl">
      <h2 className="text-lg font-bold mb-4">Poster & AI Extraction</h2>

      {posterUrl && (
        <img src={posterUrl} alt="Festival poster" className="w-full max-w-sm rounded mb-4" />
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Upload poster</label>
          <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />
          {uploading && <p className="text-sm text-gray-500 mt-1">Uploading...</p>}
        </div>

        {posterUrl && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {extracting ? "Extracting with AI..." : "Extract Artists from Poster"}
          </button>
        )}

        {extraction && (
          <div className="border rounded p-4 mt-4">
            <h3 className="font-medium mb-3">
              Extracted Artists ({extraction.artists.length}) - Review & Edit
            </h3>
            <div className="space-y-2">
              {extraction.artists.map((a, i) => (
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
                    <option value="other">Other</option>
                  </select>
                  <button
                    onClick={() => removeArtist(i)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleApplyArtists}
                disabled={saving}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Apply Artists to Festival"}
              </button>
              <button
                onClick={() => setExtraction(null)}
                className="text-gray-600 hover:text-gray-800 px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
