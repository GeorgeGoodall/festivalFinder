import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = PRICING[model] ?? { input: 3, output: 15 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

export default async function AdminUsagePage() {
  const logs = await prisma.apiUsageLog.findMany({
    orderBy: { createdAt: "desc" },
  });

  const totals = logs.reduce(
    (acc, log) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + log.inputTokens,
      outputTokens: acc.outputTokens + log.outputTokens,
      cost: acc.cost + estimateCost(log.model, log.inputTokens, log.outputTokens),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">API Usage</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold">{totals.calls}</p>
          <p className="text-sm text-gray-600">Total Calls</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold">{totals.inputTokens.toLocaleString()}</p>
          <p className="text-sm text-gray-600">Input Tokens</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold">{totals.outputTokens.toLocaleString()}</p>
          <p className="text-sm text-gray-600">Output Tokens</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <p className="text-2xl font-bold">${totals.cost.toFixed(4)}</p>
          <p className="text-sm text-gray-600">Estimated Cost</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Timestamp</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Model</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Festival</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Input Tokens</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Output Tokens</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Cost</th>
              <th className="px-4 py-3 text-sm font-medium text-gray-600">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-600">
                  {log.createdAt.toLocaleString("en-GB")}
                </td>
                <td className="px-4 py-3 text-sm">{log.model}</td>
                <td className="px-4 py-3 text-sm">{log.festivalName || "-"}</td>
                <td className="px-4 py-3 text-sm">{log.inputTokens.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm">{log.outputTokens.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm">
                  ${estimateCost(log.model, log.inputTokens, log.outputTokens).toFixed(4)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      log.success
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {log.success ? "success" : "failed"}
                  </span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-600">
                  No API calls logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
