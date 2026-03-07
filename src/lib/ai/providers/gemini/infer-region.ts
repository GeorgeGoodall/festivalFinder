import { GoogleGenerativeAI } from "@google/generative-ai";
import { UK_REGIONS } from "@/lib/constants";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

export interface InferRegionResult {
  region: string;
  usage: AiUsage;
}

const MODEL = "gemini-2.5-flash";
const REGIONS_LIST = UK_REGIONS.join(", ");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: MODEL });

export async function inferRegionFromLocation(
  location: string
): Promise<InferRegionResult> {
  const result = await model.generateContent(
    `Which UK region does this festival location belong to?

Location: "${location}"

Valid regions: ${REGIONS_LIST}

Reply with ONLY the exact region name from the list above, or "unknown" if you cannot determine it. No explanation.`
  );

  const raw = result.response.text().trim();

  const matched = UK_REGIONS.find(
    (r) => r.toLowerCase() === raw.toLowerCase()
  );

  return {
    region: matched ?? "",
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
