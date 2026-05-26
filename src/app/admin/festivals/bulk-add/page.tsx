import { BulkAddForm } from "./bulk-add-form";

export const dynamic = "force-dynamic";

export default function BulkAddPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Bulk Add Festivals</h1>
      <p className="text-sm text-gray-600 mb-6">
        Paste one URL per line. Festivals with a clear poster pick are auto-saved as drafts.
        Ambiguous ones will appear below for you to pick a poster before saving.
      </p>
      <BulkAddForm />
    </div>
  );
}
