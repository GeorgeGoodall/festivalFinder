# API Usage Tracking - Design

## Goal

Add a dedicated admin page (`/admin/usage`) that shows token usage and estimated cost for each AI API call (Claude poster extraction), plus running totals.

## Data Model

New `ApiUsageLog` Prisma model mapped to `api_usage_logs`:

| Field | Type | Description |
|-------|------|-------------|
| id | String (cuid) | Primary key |
| model | String | Model name (e.g. "claude-sonnet-4-6") |
| inputTokens | Int | Input tokens from response usage |
| outputTokens | Int | Output tokens from response usage |
| festivalId | String? | Optional FK to Festival (onDelete: SetNull) |
| festivalName | String? | Festival name from extraction result |
| success | Boolean | Whether the API call succeeded |
| createdAt | DateTime | Timestamp |

## Changes to Existing Code

### `src/lib/extraction.ts`
- Modify `extractFromPoster` return type to include usage data: `{ extraction: ExtractionResult, usage: { inputTokens: number, outputTokens: number, model: string } }`
- Extract `usage.input_tokens` and `usage.output_tokens` from the Anthropic response

### `src/app/api/admin/extract-poster/route.ts`
- After calling `extractFromPoster`, create an `ApiUsageLog` record with usage data and festival context
- Log on both success and failure paths

### `src/app/admin/layout.tsx`
- Add "Usage" nav link to `/admin/usage`

## New Files

### `src/app/admin/usage/page.tsx`
- Server component with `force-dynamic`
- Queries all `ApiUsageLog` records ordered by `createdAt` desc
- Summary section at top: total calls, total input tokens, total output tokens, total estimated cost
- Table of individual calls: timestamp, model, festival name, input/output tokens, estimated cost, success/fail badge
- Cost calculation done client-side using known Claude pricing constants

## Decisions

- **Cost calculation on frontend** — token counts stored in DB, pricing constants in the page component. Easy to update if pricing changes.
- **Start simple** — no date filtering initially, just all records with totals. Filtering can be added later.
- **Optional festival link** — `festivalId` is nullable because extraction can fail before a festival record exists. `festivalName` captured from extraction result for display even without a festival record.
