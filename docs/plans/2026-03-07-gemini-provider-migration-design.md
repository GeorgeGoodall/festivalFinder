# Design: Gemini Provider Migration for Scraping AI Steps

## Overview

Migrate the 4 scraping pipeline AI files to use Gemini 2.5 Flash, while keeping
Claude implementations available for easy swap-back via an `AI_PROVIDER` env var.

## File Structure

```
src/lib/ai/
  providers/
    gemini/
      classify-page.ts
      extract-festival.ts
      filter-links.ts
      infer-region.ts
    claude/
      classify-page.ts      (current implementation, moved verbatim)
      extract-festival.ts   (current implementation, moved verbatim)
      filter-links.ts       (current implementation, moved verbatim)
      infer-region.ts       (current implementation, moved verbatim)
  classify-page.ts          (thin router - unchanged interface)
  extract-festival.ts       (thin router - unchanged interface)
  filter-links.ts           (thin router - unchanged interface)
  infer-region.ts           (thin router - unchanged interface)
```

## Provider Routing

Each of the 4 top-level AI files becomes a thin router:

```ts
const provider = process.env.AI_PROVIDER ?? "gemini";
export { classifyPage } from provider === "claude"
  ? "./providers/claude/classify-page"
  : "./providers/gemini/classify-page";
```

Switching providers: set `AI_PROVIDER=claude` in `.env.local`. Defaults to `gemini`.
No call sites change.

## Gemini Implementation Details

- Package: `@google/generative-ai`
- Model: `gemini-2.5-flash` for all 4 steps
- Structured output: use `functionDeclarations` (function calling) with forced tool
  call for classify-page, extract-festival, filter-links — mirrors current Anthropic
  tool_use approach
- Plain text: `generateContent` for infer-region (same as current Anthropic approach)
- Token usage: `response.usageMetadata.promptTokenCount` / `candidatesTokenCount`

## Claude Implementation

Current implementations in `src/lib/ai/*.ts` move verbatim into
`src/lib/ai/providers/claude/*.ts`. No logic changes.

## Cost Tracking

Add Gemini 2.5 Flash pricing to `scrape-usage.ts` `computeCost()`:
- Input: $0.15/M tokens (<=200k context)
- Output: $3.50/M tokens
Model string `gemini-2.5-flash` triggers the new pricing branch.

## Package Changes

- Add: `@google/generative-ai`
- Keep: `@anthropic-ai/sdk` (still used by extraction.ts for poster extraction)

## Env Var

Add to `.env.local`:
```
AI_PROVIDER=gemini   # or "claude" to swap back
```
