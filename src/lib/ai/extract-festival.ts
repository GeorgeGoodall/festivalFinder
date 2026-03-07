import { extractFestivalFromText as extractGemini } from "./providers/gemini/extract-festival";
import { extractFestivalFromText as extractClaude } from "./providers/claude/extract-festival";

export type { TextExtractionResponse } from "./providers/gemini/extract-festival";

export function extractFestivalFromText(
  ...args: Parameters<typeof extractGemini>
): ReturnType<typeof extractGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude" ? extractClaude(...args) : extractGemini(...args);
}
