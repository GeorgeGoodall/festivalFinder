import { createFestival } from "@/lib/actions/festival";
import { UK_REGIONS } from "@/lib/constants";

export default function NewFestivalPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Add Festival</h1>
      <form action={createFestival} className="max-w-2xl space-y-6 bg-white p-6 rounded-lg shadow">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Festival Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
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
            <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
              Start Date *
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
              End Date *
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-gray-700">
              City *
            </label>
            <input
              id="city"
              name="city"
              type="text"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="region" className="block text-sm font-medium text-gray-700">
              Region *
            </label>
            <select
              id="region"
              name="region"
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">Select region...</option>
              {UK_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="venue" className="block text-sm font-medium text-gray-700">
            Venue
          </label>
          <input
            id="venue"
            name="venue"
            type="text"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="priceFrom" className="block text-sm font-medium text-gray-700">
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
            <label htmlFor="priceTo" className="block text-sm font-medium text-gray-700">
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
          <label htmlFor="hasCamping" className="text-sm font-medium text-gray-700">
            Has Camping
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="websiteUrl" className="block text-sm font-medium text-gray-700">
              Website URL
            </label>
            <input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="ticketUrl" className="block text-sm font-medium text-gray-700">
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

        <button
          type="submit"
          className="bg-black text-white px-6 py-2 rounded hover:bg-gray-800"
        >
          Create Festival
        </button>
      </form>
    </div>
  );
}
