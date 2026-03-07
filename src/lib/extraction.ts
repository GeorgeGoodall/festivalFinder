import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface ExtractionResult {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  region: string;
  website_url: string;
  artists: Array<{ name: string; billing: "headliner" | "support" }>;
}

export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface ExtractionResponse {
  extraction: ExtractionResult;
  usage: ExtractionUsage;
}

const extractionTool: Anthropic.Messages.Tool = {
  name: "extract_festival_info",
  description: "Extract structured festival information from a poster image",
  input_schema: {
    type: "object" as const,
    properties: {
      festival_name: { type: "string", description: "Name of the festival" },
      dates: {
        type: "object",
        properties: {
          start: { type: "string", description: "Start date in YYYY-MM-DD format" },
          end: { type: "string", description: "End date in YYYY-MM-DD format" },
        },
        required: ["start", "end"],
      },
      location: { type: "string", description: "Location of the festival - could be a venue name, town, area, or combination (e.g. 'Worthy Farm, Pilton, Somerset' or 'Victoria Park, London'). Use whatever location info is visible on the poster, or empty string" },
      region: { type: "string", description: "UK region (e.g. South East England, Scotland, Wales), or empty string" },
      website_url: { type: "string", description: "Website URL if visible on poster, or empty string" },
      artists: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Artist or band name" },
            billing: {
              type: "string",
              enum: ["headliner", "support"],
              description: "headliner = largest/most prominent names, support = all other artists",
            },
          },
          required: ["name", "billing"],
        },
        description: "All artists/bands identified on the poster",
      },
    },
    required: ["festival_name", "dates", "location", "region", "website_url", "artists"],
  },
};

export async function extractFromPoster(imageUrl: string): Promise<ExtractionResponse> {
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = response.headers.get("content-type") || "image/jpeg";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    tools: [extractionTool],
    tool_choice: { type: "tool", name: "extract_festival_info" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: base64,
            },
          },
          {
            type: "text",
            text: `Analyze this music festival poster and extract all information.

Rules:
- List ALL artists/bands you can identify on the poster
- "headliner" = largest/most prominent names, "support" = all other artists
- Do NOT include stage names, tent names, area names, or venue zones as artists (e.g. "Main Stage", "The Tent", "DJ Stage", "Acoustic Lounge" are NOT artists)
- Do NOT include sponsors, promoters, record labels, or ticket vendors as artists
- Do NOT include generic descriptive text like "plus many more", "and more TBA", "special guest" as artists
- If an artist name includes a featuring/collaboration (e.g. "Artist A feat. Artist B", "Artist A ft. Artist B", "Artist A x Artist B", "Artist A & Artist B", "Artist A b2b Artist B"), split them into SEPARATE artist entries with the same billing level
- If dates are unclear, use your best estimate. If year is missing, assume 2026
- Extract location (venue, town, area — whatever is visible) and region separately
- If a website URL is shown on the poster, include it
- If any field is unclear, use an empty string`,
          },
        ],
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
      model: "claude-sonnet-4-6",
    },
  };
}
