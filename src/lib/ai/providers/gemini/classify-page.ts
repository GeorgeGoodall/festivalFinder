import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

export type PageCategory = "lineup" | "info" | "about" | "poster_only" | "irrelevant";

export interface ClassifyPageResult {
  category: PageCategory;
  confidence: number;
  usage: AiUsage;
}

const MODEL = "gemini-2.5-flash";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const model = genAI.getGenerativeModel({
  model: MODEL,
  tools: [
    {
      functionDeclarations: [
        {
          name: "classify_page",
          description:
            "Classify the type of festival web page based on its content.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              category: {
                type: SchemaType.STRING,
                format: "enum",
                enum: ["lineup", "info", "about", "poster_only", "irrelevant"],
                description:
                  "lineup = page lists artist/band names as primary content. " +
                  "info = page contains festival dates, location, venue, description but not a lineup. " +
                  "about = page contains festival description, social media links, camping info, accessibility, age restrictions, FAQs, or ticket purchase links but not a lineup. " +
                  "poster_only = page has no structured lineup or info text but likely contains poster images. " +
                  "irrelevant = none of the above.",
              },
              confidence: {
                type: SchemaType.NUMBER,
                description:
                  "Confidence score between 0 and 1 for the classification.",
              },
            },
            required: ["category", "confidence"],
          },
        },
      ],
    },
  ],
  toolConfig: {
    functionCallingConfig: {
      mode: FunctionCallingMode.ANY,
      allowedFunctionNames: ["classify_page"],
    },
  },
});

export async function classifyPage(
  text: string,
  jsonLd: string | null,
  hasImages: boolean
): Promise<ClassifyPageResult> {
  let userContent = "";
  if (jsonLd) {
    userContent += `JSON-LD metadata:\n${jsonLd}\n\n`;
  }
  userContent += `Page text (first 3000 chars):\n${text.slice(0, 3000)}`;
  if (hasImages) {
    userContent += "\n\nNote: this page also contains images.";
  }

  const result = await model.generateContent(userContent);
  const call = result.response.functionCalls()?.[0];

  const usage: AiUsage = {
    inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
    model: MODEL,
  };

  if (!call) {
    return { category: "irrelevant", confidence: 0, usage };
  }

  const args = call.args as { category: PageCategory; confidence: number };

  return {
    category: args.category,
    confidence: args.confidence,
    usage,
  };
}
