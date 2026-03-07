import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "@/lib/extraction";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const MAX_CONTENT_LENGTH = 30_000;

export interface TextExtractionResponse {
  extraction: ExtractionResult;
  usage: AiUsage;
}

const extractionTool: Anthropic.Messages.Tool = {
  name: "extract_festival_info",
  description:
    "Extract structured festival information from website text content",
  input_schema: {
    type: "object" as const,
    properties: {
      festival_name: { type: "string", description: "Name of the festival" },
      dates: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Start date in YYYY-MM-DD format",
          },
          end: {
            type: "string",
            description: "End date in YYYY-MM-DD format",
          },
        },
        required: ["start", "end"],
      },
      location: {
        type: "string",
        description:
          "Location of the festival - could be a venue name, town, area, or combination (e.g. 'Worthy Farm, Pilton, Somerset' or 'Victoria Park, London'). Use whatever location info is available, or empty string",
      },
      region: {
        type: "string",
        description:
          "UK region (e.g. South East England, Scotland, Wales), or empty string",
      },
      website_url: {
        type: "string",
        description: "Website URL if found in content, or empty string",
      },
      artists: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Artist or band name" },
            billing: {
              type: "string",
              enum: ["headliner", "support"],
              description:
                "headliner = largest/most prominent names, support = all other artists",
            },
          },
          required: ["name", "billing"],
        },
        description: "All artists/bands identified across the pages",
      },
    },
    required: [
      "festival_name",
      "dates",
      "location",
      "region",
      "website_url",
      "artists",
    ],
  },
};

export async function extractFestivalFromText(
  lineupContent: { url: string; text: string }[],
  infoContent: { url: string; text: string }[],
  websiteUrl: string
): Promise<TextExtractionResponse> {
  // Assemble content: info pages first, then lineup pages
  const parts: string[] = [];
  for (const page of infoContent) {
    parts.push(`--- Source: ${page.url} ---\n${page.text}`);
  }
  for (const page of lineupContent) {
    parts.push(`--- Source: ${page.url} ---\n${page.text}`);
  }

  let assembled = parts.join("\n\n");
  if (assembled.length > MAX_CONTENT_LENGTH) {
    assembled = assembled.slice(0, MAX_CONTENT_LENGTH);
  }

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    tools: [extractionTool],
    tool_choice: { type: "tool", name: "extract_festival_info" },
    messages: [
      {
        role: "user",
        content: `Analyze the following festival website content and extract all festival information.

The festival website is: ${websiteUrl}

Rules:
- Extract the festival name, dates, location, region, and website URL
- List ALL artists/bands found across the pages
- "headliner" = most prominent/top-billed artists, "support" = all other artists
- Do NOT include stage names, venue areas, sponsors, or generic text as artists
- If an artist name includes a featuring/collaboration (e.g. "Artist A feat. Artist B", "Artist A ft. Artist B", "Artist A x Artist B", "Artist A & Artist B", "Artist A b2b Artist B"), split them into SEPARATE artist entries with the same billing level
- If dates are unclear, use your best estimate. If year is missing, assume 2026
- If any field is unclear, use an empty string

Website content:

${assembled}`,
      },
    ],
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("No tool_use block in AI response");
  }

  return {
    extraction: toolBlock.input as ExtractionResult,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-haiku-4-5-20251001",
    },
  };
}
