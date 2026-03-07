import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";
import type { ExtractionResult } from "@/lib/extraction";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const MODEL = "gemini-2.5-flash";
const MAX_CONTENT_LENGTH = 30_000;

export interface TextExtractionResponse {
  extraction: ExtractionResult;
  usage: AiUsage;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const model = genAI.getGenerativeModel({
  model: MODEL,
  tools: [
    {
      functionDeclarations: [
        {
          name: "extract_festival_info",
          description:
            "Extract structured festival information from website text content",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              festival_name: {
                type: SchemaType.STRING,
                description: "Name of the festival",
              },
              dates: {
                type: SchemaType.OBJECT,
                properties: {
                  start: {
                    type: SchemaType.STRING,
                    description: "Start date in YYYY-MM-DD format",
                  },
                  end: {
                    type: SchemaType.STRING,
                    description: "End date in YYYY-MM-DD format",
                  },
                },
                required: ["start", "end"],
              },
              location: {
                type: SchemaType.STRING,
                description:
                  "Location of the festival - could be a venue name, town, area, or combination. Use whatever location info is available, or empty string",
              },
              region: {
                type: SchemaType.STRING,
                description:
                  "UK region (e.g. South East England, Scotland, Wales), or empty string",
              },
              website_url: {
                type: SchemaType.STRING,
                description: "Website URL if found in content, or empty string",
              },
              description: {
                type: SchemaType.STRING,
                description: "Short 2-3 sentence description of the festival, or empty string",
              },
              ticket_url: {
                type: SchemaType.STRING,
                description: "URL of the ticket purchase page, or empty string",
              },
              social_links: {
                type: SchemaType.OBJECT,
                properties: {
                  instagram: { type: SchemaType.STRING, description: "Instagram profile URL, or empty string" },
                  facebook: { type: SchemaType.STRING, description: "Facebook page URL, or empty string" },
                  x: { type: SchemaType.STRING, description: "X (Twitter) profile URL, or empty string" },
                  tiktok: { type: SchemaType.STRING, description: "TikTok profile URL, or empty string" },
                },
              },
              has_camping: {
                type: SchemaType.BOOLEAN,
                description: "true if camping is available at the festival",
              },
              camping_details: {
                type: SchemaType.STRING,
                description: "Extra camping info e.g. 'glamping available, day tickets only', or empty string",
              },
              age_restriction: {
                type: SchemaType.STRING,
                description: "e.g. '18+', 'family-friendly', 'all ages', or empty string",
              },
              artists: {
                type: SchemaType.ARRAY,
                items: {
                  type: SchemaType.OBJECT,
                  properties: {
                    name: {
                      type: SchemaType.STRING,
                      description: "Artist or band name",
                    },
                    billing: {
                      type: SchemaType.STRING,
                      format: "enum",
                      enum: ["headliner", "support"],
                      description:
                        "headliner = largest/most prominent names, support = all other artists",
                    },
                    genre: {
                      type: SchemaType.STRING,
                      description: "Lowercase genre tag e.g. 'rock', 'electronic', 'folk', 'hip-hop'. Leave empty string if unclear.",
                    },
                    day: {
                      type: SchemaType.NUMBER,
                      description: "Day number (1, 2, 3...) this artist performs. Only set if explicitly stated in the lineup.",
                    },
                    stage: {
                      type: SchemaType.STRING,
                      description: "Stage name e.g. 'Main Stage', 'The Barn'. Only set if explicitly stated.",
                    },
                  },
                  required: ["name", "billing"],
                },
                description: "All artists/bands identified across the pages",
              },
              lineup_pending: {
                type: SchemaType.BOOLEAN,
                description:
                  "true if the festival lineup has not been announced yet — e.g. 'lineup coming soon', 'artists TBA', 'acts to be announced', 'lineup to follow', 'coming soon'. false if artists are listed.",
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
        },
      ],
    },
  ],
  toolConfig: {
    functionCallingConfig: {
      mode: FunctionCallingMode.ANY,
      allowedFunctionNames: ["extract_festival_info"],
    },
  },
});

export async function extractFestivalFromText(
  lineupContent: { url: string; text: string }[],
  infoContent: { url: string; text: string }[],
  websiteUrl: string,
  aboutContent: { url: string; text: string }[] = []
): Promise<TextExtractionResponse> {
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

  const result = await model.generateContent(
    `Analyze the following festival website content and extract all festival information.

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
- Extract a short (2-3 sentence) description of the festival from about/info content — summarise what kind of festival it is, where and when
- Extract ticket_url if a dedicated ticket purchase page is linked
- Extract social_links: full URLs only (not handles), leave empty string if not found
- Set has_camping to true if the festival mentions camping is available
- Extract camping_details for extra detail beyond yes/no (e.g. "glamping available")
- Extract age_restriction if stated (e.g. "18+", "family-friendly")
- For each artist, set genre if clearly indicated (e.g. "jazz artist", "DJ", listed under a genre section). Use simple lowercase tags.
- Set artist day and stage ONLY when explicitly stated in lineup content. Do not infer.

Website content:

${assembled}`
  );

  const call = result.response.functionCalls()?.[0];
  if (!call) {
    throw new Error("No function call in Gemini response");
  }

  return {
    extraction: call.args as ExtractionResult,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
