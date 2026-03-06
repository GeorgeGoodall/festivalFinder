import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export interface ExtractionResult {
  festival_name: string;
  dates: { start: string; end: string };
  location: string;
  artists: Array<{ name: string; billing: "headliner" | "support" | "other" }>;
}

export async function extractFromPoster(imageUrl: string): Promise<ExtractionResult> {
  const response = await fetch(imageUrl);
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = response.headers.get("content-type") || "image/jpeg";

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
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
            text: `Analyze this music festival poster and extract the following information as JSON:

{
  "festival_name": "Name of the festival",
  "dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "location": "City or venue, Region",
  "artists": [
    { "name": "Artist Name", "billing": "headliner" | "support" | "other" }
  ]
}

Rules:
- List ALL artists/bands you can identify on the poster
- "headliner" = largest/most prominent names, "support" = medium names, "other" = smallest names
- If dates are unclear, use your best estimate. If year is missing, assume 2026
- If location is unclear, put "Unknown"
- Return ONLY valid JSON, no other text`,
          },
        ],
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from AI response");
  }

  return JSON.parse(jsonMatch[0]) as ExtractionResult;
}
