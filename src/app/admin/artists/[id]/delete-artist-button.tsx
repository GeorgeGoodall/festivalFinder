"use client";

import { useActionState } from "react";

export function DeleteArtistButton({
  deleteAction,
  festivalCount,
}: {
  deleteAction: () => Promise<void>;
  festivalCount: number;
}) {
  const [, formAction, isPending] = useActionState(
    async () => {
      const message =
        festivalCount > 0
          ? `This artist belongs to ${festivalCount} festival${festivalCount === 1 ? "" : "s"} and will be removed from ${festivalCount === 1 ? "it" : "all of them"}. Are you sure you want to delete?`
          : "Are you sure you want to delete this artist?";

      if (!confirm(message)) return;
      await deleteAction();
    },
    undefined
  );

  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={isPending}
        className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete Artist"}
      </button>
    </form>
  );
}
