import { filterLinksForFestival as filterGemini } from "./providers/gemini/filter-links";
import { filterLinksForFestival as filterClaude } from "./providers/claude/filter-links";

export type { FilterLinksResult, LinkCandidate } from "./providers/gemini/filter-links";

export function filterLinksForFestival(
  ...args: Parameters<typeof filterGemini>
): ReturnType<typeof filterGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude" ? filterClaude(...args) : filterGemini(...args);
}
