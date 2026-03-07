import { classifyPage as classifyPageGemini } from "./providers/gemini/classify-page";
import { classifyPage as classifyPageClaude } from "./providers/claude/classify-page";

export type { ClassifyPageResult, PageCategory } from "./providers/gemini/classify-page";

export function classifyPage(
  ...args: Parameters<typeof classifyPageGemini>
): ReturnType<typeof classifyPageGemini> {
  const provider = process.env.AI_PROVIDER ?? "gemini";
  return provider === "claude"
    ? classifyPageClaude(...args)
    : classifyPageGemini(...args);
}
