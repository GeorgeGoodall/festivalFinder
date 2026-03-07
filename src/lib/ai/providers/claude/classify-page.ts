import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

export type PageCategory = "lineup" | "info" | "poster_only" | "irrelevant";

export interface ClassifyPageResult {
  category: PageCategory;
  confidence: number;
  usage: AiUsage;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_page",
  description: "Classify the type of festival web page based on its content.",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: ["lineup", "info", "poster_only", "irrelevant"],
        description:
          "lineup = page lists artist/band names as primary content. " +
          "info = page contains festival dates, location, venue, description but not a lineup. " +
          "poster_only = page has no structured lineup or info text but likely contains poster images. " +
          "irrelevant = none of the above.",
      },
      confidence: {
        type: "number",
        description:
          "Confidence score between 0 and 1 for the classification.",
      },
    },
    required: ["category", "confidence"],
  },
};

export async function classifyPage(
  text: string,
  jsonLd: string | null,
  hasImages: boolean
): Promise<ClassifyPageResult> {
  const MODEL = "claude-haiku-4-5-20251001";

  let userContent = "";
  if (jsonLd) {
    userContent += `JSON-LD metadata:\n${jsonLd}\n\n`;
  }
  userContent += `Page text (first 3000 chars):\n${text.slice(0, 3000)}`;
  if (hasImages) {
    userContent += "\n\nNote: this page also contains images.";
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 128,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_page" },
    messages: [{ role: "user", content: userContent }],
  });

  const usage: AiUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: MODEL,
  };

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolBlock) {
    return { category: "irrelevant", confidence: 0, usage };
  }

  const input = toolBlock.input as {
    category: PageCategory;
    confidence: number;
  };

  return {
    category: input.category,
    confidence: input.confidence,
    usage,
  };
}
