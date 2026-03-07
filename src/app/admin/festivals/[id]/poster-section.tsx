"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { POSTER_CATEGORIES } from "@/lib/constants";

interface Artist {
  name: string;
  billing: "headliner" | "support";
}

interface Poster {
  id: string;
  category: string;
  customCategory: string | null;
  imageUrl: string;
  version: number;
}

interface PosterSectionProps {
  festivalId: string;
  posters: Poster[];
}

function getCategoryLabel(category: string, customCategory: string | null) {
  if (category === "other" && customCategory) return customCategory;
  return POSTER_CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

export function PosterSection({ festivalId, posters }: PosterSectionProps) {
  const router = useRouter();

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("full_lineup");
  const [customCategory, setCustomCategory] = useState("");

  // Per-poster extraction state, keyed by poster id
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<{
    posterId: string;
    artists: Artist[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("festivalId", festivalId);
    formData.append("category", selectedCategory);
    if (selectedCategory === "other" && customCategory) {
      formData.append("customCategory", customCategory);
    }

    await fetch("/api/admin/upload-poster", { method: "POST", body: formData });
    setUploading(false);
    setCustomCategory("");
    form.reset();
    router.refresh();
  }

  async function handleExtract(poster: Poster) {
    setExtractingId(poster.id);

    const res = await fetch("/api/admin/extract-poster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterUrl: poster.imageUrl }),
    });

    const data = await res.json();
    setExtraction({ posterId: poster.id, artists: data.extraction.artists });
    setExtractingId(null);
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
    <div className="bg-white p-6 rounded-lg shadow max-w-4xl mt-8">
      <h2 className="text-lg font-bold mb-4">Posters & AI Extraction</h2>

      {/* Upload form */}
      <form onSubmit={handleUpload} className="space-y-3 mb-6">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Poster image
            </label>
            <input
              type="file"
              name="file"
              accept="image/*"
              required
              disabled={uploading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {POSTER_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          {selectedCategory === "other" && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Custom category name
              </label>
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g. VIP Stage"
                required
                className="rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={uploading}
            className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50 text-sm"
          >
            {uploading ? "Uploading..." : "Upload Poster"}
          </button>
        </div>
      </form>

      {/* Poster grid */}
      {posters.length === 0 ? (
        <p className="text-gray-500 text-sm">No posters uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {posters.map((poster) => (
            <div
              key={poster.id}
              className="border rounded-lg overflow-hidden"
            >
              <div className="w-full h-48 bg-gray-100 flex items-center justify-center overflow-hidden">
                <img
                  src={poster.imageUrl}
                  alt={getCategoryLabel(poster.category, poster.customCategory)}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    {getCategoryLabel(poster.category, poster.customCategory)}
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                    v{poster.version}
                  </span>
                </div>
                <button
                  onClick={() => handleExtract(poster)}
                  disabled={extractingId === poster.id}
                  className="w-full bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {extractingId === poster.id
                    ? "Extracting..."
                    : "Extract Artists"}
                </button>
              </div>

              {/* Extraction review for this poster */}
              {extraction && extraction.posterId === poster.id && (
                <div className="border-t p-3">
                  <h3 className="font-medium text-sm mb-2">
                    Extracted Artists ({extraction.artists.length}) - Review &
                    Edit
                  </h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {extraction.artists.map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          value={a.name}
                          onChange={(e) =>
                            updateArtist(i, "name", e.target.value)
                          }
                          className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                        />
                        <select
                          value={a.billing}
                          onChange={(e) =>
                            updateArtist(i, "billing", e.target.value)
                          }
                          className="rounded border border-gray-300 px-1 py-1 text-xs"
                        >
                          <option value="headliner">Headliner</option>
                          <option value="support">Support</option>
                        </select>
                        <button
                          onClick={() => removeArtist(i)}
                          className="text-red-500 hover:text-red-700 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={handleApplyArtists}
                      disabled={saving}
                      className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Apply Artists"}
                    </button>
                    <button
                      onClick={() => setExtraction(null)}
                      className="text-gray-600 px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
