import { inferRegionFromLocation as inferGemini } from "./providers/gemini/infer-region";
import { inferRegionFromLocation as inferClaude } from "./providers/claude/infer-region";

export type { InferRegionResult } from "./providers/gemini/infer-region";

export function inferRegionFromLocation(
  ...args: Parameters<typeof inferGemini>
): ReturnType<typeof inferGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude" ? inferClaude(...args) : inferGemini(...args);
}
