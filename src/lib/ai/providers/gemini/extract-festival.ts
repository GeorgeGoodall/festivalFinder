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
  websiteUrl: string
): Promise<TextExtractionResponse> {
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
