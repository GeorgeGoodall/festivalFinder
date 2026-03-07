import Anthropic from "@anthropic-ai/sdk";
import { UK_REGIONS } from "@/lib/constants";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface InferRegionResult {
  region: string;
  usage: AiUsage;
}

const MODEL = "claude-haiku-4-5-20251001";

const REGIONS_LIST = UK_REGIONS.join(", ");

export async function inferRegionFromLocation(
  location: string
): Promise<InferRegionResult> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 32,
    messages: [
      {
        role: "user",
        content: `Which UK region does this festival location belong to?

Location: "${location}"

Valid regions: ${REGIONS_LIST}

Reply with ONLY the exact region name from the list above, or "unknown" if you cannot determine it. No explanation.`,
      },
    ],
  });

  const raw =
    message.content[0].type === "text" ? message.content[0].text.trim() : "";

  // Validate against the known list (case-insensitive match → use canonical casing)
  const matched = UK_REGIONS.find(
    (r) => r.toLowerCase() === raw.toLowerCase()
  );

  return {
    region: matched ?? "",
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: MODEL,
    },
  };
}
