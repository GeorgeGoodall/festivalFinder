# API Usage Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/admin/usage` page that shows token usage and estimated cost for each AI poster extraction call.

**Architecture:** New `ApiUsageLog` Prisma model stores token counts per API call. `extractFromPoster` returns usage data alongside extraction results. The API route logs usage to the DB. A new admin page queries and displays the logs with client-side cost calculation.

**Tech Stack:** Prisma 7, Next.js App Router, Anthropic SDK (already in use), Tailwind CSS v4

---

### Task 1: Add ApiUsageLog model to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:99` (after AdminUser model)

**Step 1: Add the model to schema.prisma**

Add after the `AdminUser` model (after line 99):

```prisma
model ApiUsageLog {
  id           String   @id @default(cuid())
  model        String
  inputTokens  Int      @map("input_tokens")
  outputTokens Int      @map("output_tokens")
  festivalId   String?  @map("festival_id")
  festivalName String?  @map("festival_name")
  success      Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")

  festival Festival? @relation(fields: [festivalId], references: [id], onDelete: SetNull)

  @@map("api_usage_logs")
}
```

Also add the reverse relation to the `Festival` model (after line 50, after `artists FestivalArtist[]`):

```prisma
  usageLogs ApiUsageLog[]
```

**Step 2: Run the migration**

Run: `npx prisma migrate dev --name add-api-usage-log`
Expected: Migration created and applied, Prisma Client regenerated.

**Step 3: Verify generated client has the new model**

Run: `npx prisma generate`
Expected: Client generated at `src/generated/prisma`

**Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/
git commit -m "feat: add ApiUsageLog model for tracking AI token usage"
```

---

### Task 2: Modify extractFromPoster to return usage data

**Files:**
- Modify: `src/lib/extraction.ts:55-101`

**Step 1: Add usage type and update return type**

Add a new interface after `ExtractionResult` (after line 13):

```typescript
export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface ExtractionResponse {
  extraction: ExtractionResult;
  usage: ExtractionUsage;
}
```

**Step 2: Update the function signature and return value**

Change line 55 from:
```typescript
export async function extractFromPoster(imageUrl: string): Promise<ExtractionResult> {
```
to:
```typescript
export async function extractFromPoster(imageUrl: string): Promise<ExtractionResponse> {
```

Change lines 95-100 from:
```typescript
  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("No tool_use block in AI response");
  }

  return toolBlock.input as ExtractionResult;
```
to:
```typescript
  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("No tool_use block in AI response");
  }

  return {
    extraction: toolBlock.input as ExtractionResult,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-sonnet-4-6",
    },
  };
```

**Step 3: Commit**

```bash
git add src/lib/extraction.ts
git commit -m "feat: return token usage data from extractFromPoster"
```

---

### Task 3: Update extract-poster API route to log usage

**Files:**
- Modify: `src/app/api/admin/extract-poster/route.ts:9-28`

**Step 1: Update the POST handler to use new return type and log usage**

Replace the POST function body (lines 9-28) with:

```typescript
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { posterUrl } = await req.json();

  if (!posterUrl) {
    return NextResponse.json({ error: "Missing posterUrl" }, { status: 400 });
  }

  try {
    logger.info("Starting poster extraction", { posterUrl });
    const { extraction, usage } = await extractFromPoster(posterUrl);
    logger.info("Extraction successful", { festivalName: extraction.festival_name, artistCount: extraction.artists.length });

    await prisma.apiUsageLog.create({
      data: {
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        festivalName: extraction.festival_name,
        success: true,
      },
    });

    return NextResponse.json({ extraction });
  } catch (error) {
    logger.error("Extraction failed", error);
    return NextResponse.json({ error: "Extraction failed", details: String(error) }, { status: 500 });
  }
}
```

**Step 2: Verify the app compiles**

Run: `npx next build` or `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/app/api/admin/extract-poster/route.ts
git commit -m "feat: log API token usage after poster extraction"
```

---

### Task 4: Add Usage nav link to admin layout

**Files:**
- Modify: `src/app/admin/layout.tsx:10`

**Step 1: Add the Usage link**

After line 9 (the Submissions link), add:

```tsx
          <Link href="/admin/usage" className="text-gray-700 hover:text-gray-900">Usage</Link>
```

**Step 2: Commit**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat: add Usage nav link to admin layout"
```

---

### Task 5: Create the /admin/usage page

**Files:**
- Create: `src/app/admin/usage/page.tsx`

**Step 1: Create the usage page**

```tsx
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
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
```

**Step 2: Verify the page loads**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 3: Commit**

```bash
git add src/app/admin/usage/page.tsx
git commit -m "feat: add admin usage page with token tracking and cost estimation"
```
