import * as cheerio from "cheerio";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/**
 * Fetch a URL and return the raw HTML string.
 */
export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FestivalFinder/1.0; +https://festivalfinder.uk)",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Strip non-content elements from HTML and return clean text.
 * Also extracts JSON-LD data if present.
 */
export function cleanHtml(html: string): { text: string; jsonLd: string | null } {
  const $ = cheerio.load(html);

  // Extract JSON-LD before stripping scripts
  let jsonLd: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).html();
    if (content) {
      jsonLd = (jsonLd ? jsonLd + "\n" : "") + content;
    }
  });

  // Remove non-content elements
  $("script, style, nav, footer, header, iframe, noscript, svg, form").remove();
  $("[role='navigation'], [role='banner'], [role='contentinfo']").remove();

  // Get text, collapse whitespace
  const text = $("body")
    .text()
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, jsonLd };
}

/**
 * SHA-256 hash of the cleaned text content for change detection.
 */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Combined validation + extraction LLM call.
 */
export interface ScrapeExtractionResult {
  isLineupPage: boolean;
  rejectionReason?: string;
  artists: Array<{ name: string; billing: "headliner" | "support" }>;
}

export interface ScrapeExtractionResponse {
  extraction: ScrapeExtractionResult;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

const scrapeExtractionTool: Anthropic.Messages.Tool = {
  name: "extract_lineup",
  description:
    "Validate whether text is from a festival lineup page and extract artist names",
  input_schema: {
    type: "object" as const,
    properties: {
      is_lineup_page: {
        type: "boolean",
        description:
          "true if this text appears to be from a festival lineup/artist listing page",
      },
      rejection_reason: {
        type: "string",
        description:
          "If is_lineup_page is false, explain why. Empty string if true.",
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
                "headliner = largest/most prominent names (typically top-billed), support = all others",
            },
          },
          required: ["name", "billing"],
        },
        description:
          "All artists/bands found on the page. Empty array if is_lineup_page is false.",
      },
    },
    required: ["is_lineup_page", "rejection_reason", "artists"],
  },
};

export async function extractFromPage(
  cleanedText: string,
  jsonLd: string | null
): Promise<ScrapeExtractionResponse> {
  let content = `Analyze this text extracted from a festival website page.\n\n`;
  if (jsonLd) {
    content += `JSON-LD structured data found on the page:\n${jsonLd}\n\n`;
  }
  content += `Page text content:\n${cleanedText.slice(0, 15000)}`;
  content += `\n\nRules:
- First determine if this is a festival lineup/artist listing page
- If it is NOT a lineup page, set is_lineup_page to false and explain why in rejection_reason
- If it IS a lineup page, extract ALL artist/band names
- "headliner" = most prominent/top-billed acts, "support" = all other artists
- Do NOT include stage names, venue areas, sponsors, or generic text as artists
- If an artist name includes featuring/collaboration (e.g. "Artist A feat. Artist B"), split into SEPARATE entries with the same billing`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    tools: [scrapeExtractionTool],
    tool_choice: { type: "tool", name: "extract_lineup" },
    messages: [{ role: "user", content }],
  });

  const toolBlock = message.content.find((block) => block.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("No tool_use block in AI response");
  }

  const input = toolBlock.input as {
    is_lineup_page: boolean;
    rejection_reason: string;
    artists: Array<{ name: string; billing: "headliner" | "support" }>;
  };

  return {
    extraction: {
      isLineupPage: input.is_lineup_page,
      rejectionReason: input.rejection_reason || undefined,
      artists: input.artists || [],
    },
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      model: "claude-haiku-4-5-20251001",
    },
  };
}
