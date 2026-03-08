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
      description: {
        type: "string",
        description: "Short 2-3 sentence description of the festival, or empty string",
      },
      ticket_url: {
        type: "string",
        description: "URL of the ticket purchase page, or empty string",
      },
      social_links: {
        type: "object" as const,
        properties: {
          instagram: { type: "string", description: "Instagram profile URL, or empty string" },
          facebook: { type: "string", description: "Facebook page URL, or empty string" },
          x: { type: "string", description: "X (Twitter) profile URL, or empty string" },
          tiktok: { type: "string", description: "TikTok profile URL, or empty string" },
        },
      },
      has_camping: {
        type: "boolean" as const,
        description: "true if camping is available at the festival",
      },
      camping_details: {
        type: "string",
        description: "Extra camping info e.g. 'glamping available, day tickets only', or empty string",
      },
      age_restriction: {
        type: "string",
        description: "e.g. '18+', 'family-friendly', 'all ages', or empty string",
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
            genre: {
              type: "string",
              description: "Lowercase genre tag e.g. 'rock', 'electronic', 'folk', 'hip-hop'. Leave empty string if unclear.",
            },
            day: {
              type: "number",
              description: "Day number (1, 2, 3...) this artist performs. Only set if explicitly stated in the lineup.",
            },
            stage: {
              type: "string",
              description: "Stage name e.g. 'Main Stage', 'The Barn'. Only set if explicitly stated.",
            },
          },
          required: ["name", "billing"],
        },
        description: "All artists/bands identified across the pages",
      },
      lineup_pending: {
        type: "boolean" as const,
        description:
          "true if the festival lineup has not been announced yet — e.g. 'lineup coming soon', 'artists TBA', 'acts to be announced', 'lineup to follow'. false if artists are listed.",
      },
      lineup_may_be_incomplete: {
        type: "boolean" as const,
        description:
          "true if there are signals the artist list may be incomplete due to JavaScript lazy-loading or pagination — e.g. text like 'view all artists', 'see all acts', 'showing X of Y', 'load more', pagination controls visible, or the list ends abruptly mid-alphabet or at a suspiciously round number. false if the list appears complete.",
      },
    },
    required: [
      "festival_name",
      "dates",
      "location",
      "region",
      "website_url",
      "artists",
      "lineup_pending",
    ],
  },
};

export async function extractFestivalFromText(
  lineupContent: { url: string; text: string }[],
  infoContent: { url: string; text: string }[],
  websiteUrl: string,
  aboutContent: { url: string; text: string }[] = []
): Promise<TextExtractionResponse> {
  // Assemble content: info pages first, then about pages, then lineup pages
  const parts: string[] = [];
  for (const page of infoContent) {
    parts.push(`--- Source: ${page.url} ---\n${page.text}`);
  }
  for (const page of aboutContent) {
    parts.push(`--- Source (about): ${page.url} ---\n${page.text}`);
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
- Set lineup_pending to true if the site says the lineup has not yet been announced (e.g. "coming soon", "TBA", "to be announced", "lineup coming soon"). Set to false if artists are listed.
- Set lineup_may_be_incomplete to true if you see signals the artist list may be truncated by lazy-loading or pagination (e.g. "view all artists", "see all acts", "showing X of Y artists", "load more", pagination numbers, or an artist list that ends abruptly). Set to false otherwise.
- Extract a short (2-3 sentence) description of the festival from about/info content — summarise what kind of festival it is, where and when
- Extract ticket_url if a dedicated ticket purchase page is linked
- Extract social_links: full URLs only (not handles), leave empty string if not found
- Set has_camping to true if the festival mentions camping is available
- Extract camping_details for extra detail beyond yes/no (e.g. "glamping available")
- Extract age_restriction if stated (e.g. "18+", "family-friendly")
- For each artist, set genre if clearly indicated (e.g. "jazz artist", "DJ", listed under a genre section). Use simple lowercase tags.
- Set artist day and stage ONLY when explicitly stated in lineup content. Do not infer.

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
