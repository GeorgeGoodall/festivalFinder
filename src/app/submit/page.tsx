"use client";

import { useState } from "react";

export default function SubmitFestivalPage() {
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error" | "duplicate"
  >("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");

    const formData = new FormData(e.currentTarget);
    const res = await fetch("/api/submissions", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();

    if (res.ok) {
      setStatus("success");
    } else if (data.error === "duplicate") {
      setStatus("duplicate");
      setMessage(data.message);
    } else {
      setStatus("error");
      setMessage(data.error || "Something went wrong");
    }
  }

  if (status === "success") {
    return (
      <div className="max-w-lg mx-auto py-16 px-4 text-center">
        <h1 className="text-2xl font-bold mb-4">
          Thanks for your submission!
        </h1>
        <p className="text-gray-600">
          Your festival has been submitted for review. Our team will check it
          and add it to the database if approved.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-16 px-4">
      <h1 className="text-2xl font-bold mb-2">Submit a Festival</h1>
      <p className="text-gray-600 mb-6">
        Know a festival that&apos;s not in our database? Submit it and
        we&apos;ll review it.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Festival Name *
          </label>
          <input
            name="festivalName"
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Location (city, region)
          </label>
          <input
            name="locationHint"
            placeholder="e.g. Pilton, Somerset"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Festival Poster
          </label>
          <input name="poster" type="file" accept="image/*" className="mt-1" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Your Email (optional)
          </label>
          <input
            name="submitterEmail"
            type="email"
            placeholder="We'll notify you when it's approved"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        {status === "duplicate" && (
          <p className="text-amber-600 text-sm">{message}</p>
        )}
        {status === "error" && (
          <p className="text-red-600 text-sm">{message}</p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
        >
          {status === "submitting" ? "Submitting..." : "Submit Festival"}
        </button>
      </form>
    </div>
  );
}
