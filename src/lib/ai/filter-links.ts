import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

export interface LinkCandidate {
  url: string;
  text: string;
  context: string;
}

export interface FilterLinksResult {
  selectedIndices: number[];
  selected: LinkCandidate[];
  usage: AiUsage;
}

const MODEL = "claude-haiku-4-5-20251001";

export async function filterLinksForFestival(
  links: LinkCandidate[]
): Promise<FilterLinksResult> {
  if (links.length === 0) {
    return {
      selectedIndices: [],
      selected: [],
      usage: { inputTokens: 0, outputTokens: 0, model: MODEL },
    };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const numberedList = links
    .map(
      (link, i) =>
        `[${i}] URL: ${link.url} Text: "${link.text}" Context: "${link.context}"`
    )
    .join("\n");

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    tools: [
      {
        name: "select_relevant_links",
        description:
          "Select the indices of links that are relevant to discovering festival information.",
        input_schema: {
          type: "object" as const,
          properties: {
            relevant_indices: {
              type: "array",
              items: { type: "number" },
              description: "Array of indices of relevant links",
            },
          },
          required: ["relevant_indices"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "select_relevant_links" },
    messages: [
      {
        role: "user",
        content: `You are filtering links found on a music festival website. Select the links most likely to lead to useful festival information.

INCLUDE links leading to:
- Lineup / artists / performers / acts
- About / info pages
- Tickets
- Programme / schedule / stages / days

EXCLUDE links leading to:
- Contact, privacy, terms, news, blog, press, careers
- Login, shop/merch, social media
- Accessibility, FAQs, cookies

When unsure, include the link (false positives are cheap).

Here are the links:
${numberedList}`,
      },
    ],
  });

  // Parse the tool_use response
  const toolUseBlock = message.content.find(
    (block) => block.type === "tool_use"
  );

  let selectedIndices: number[] = [];
  if (toolUseBlock && toolUseBlock.type === "tool_use") {
    const input = toolUseBlock.input as { relevant_indices: number[] };
    // Filter indices to valid range
    selectedIndices = input.relevant_indices.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < links.length
    );
  }

  const selected = selectedIndices.map((i) => links[i]);

  return {
    selectedIndices,
    selected,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: MODEL,
    },
  };
}
