import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
  type Part,
} from "@google/generative-ai";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

const MODEL = "gemini-2.5-flash";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export interface ImageForDisambiguation {
  base64: string;
  contentType: string;
  src: string; // for logging only
}

export interface SelectPosterResult {
  selectedIndex: number;
  usage: AiUsage;
}

export async function selectPosterWithGemini(
  images: ImageForDisambiguation[]
): Promise<SelectPosterResult> {
  if (images.length === 0) {
    return { selectedIndex: 0, usage: { inputTokens: 0, outputTokens: 0, model: MODEL } };
  }

  if (images.length === 1) {
    return { selectedIndex: 0, usage: { inputTokens: 0, outputTokens: 0, model: MODEL } };
  }

  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [
      {
        functionDeclarations: [
          {
            name: "select_lineup_poster",
            description: "Select the index of the image most likely to be a festival lineup poster.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                selected_index: {
                  type: SchemaType.NUMBER,
                  description: "Zero-based index of the image that is a festival lineup poster, or -1 if none appear to be a lineup poster.",
                },
                reason: {
                  type: SchemaType.STRING,
                  description: "Brief explanation of why this image was selected.",
                },
              },
              required: ["selected_index", "reason"],
            },
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: ["select_lineup_poster"],
      },
    },
  });

  // Build content parts: text prompt + one image per candidate
  const parts: Part[] = [
    {
      text: `You are given ${images.length} images from a music festival website. Identify which image (if any) is a festival lineup poster — an image that shows the names of artists or bands performing at the festival, typically in a stylised graphic format with the festival name and dates.

A lineup poster usually:
- Lists multiple artist/band names in varying font sizes (headliners largest)
- Shows the festival name and often the dates
- Has a designed/branded appearance

It is NOT a hero banner, sponsor logo, general marketing image, or site decoration.

Examine each image and call select_lineup_poster with the index (0-based) of the lineup poster, or -1 if none qualify.`,
    },
  ];

  for (let i = 0; i < images.length; i++) {
    parts.push({ text: `Image ${i}:` });
    parts.push({
      inlineData: {
        mimeType: images[i].contentType,
        data: images[i].base64,
      },
    });
  }

  const result = await model.generateContent({ contents: [{ role: "user", parts }] });

  const call = result.response.functionCalls()?.[0];
  let selectedIndex = 0;
  if (call) {
    const args = call.args as { selected_index: number; reason: string };
    console.log(`[poster-select] Gemini selected index ${args.selected_index}: ${args.reason}`);
    selectedIndex = args.selected_index >= 0 && args.selected_index < images.length
      ? args.selected_index
      : 0;
  }

  return {
    selectedIndex,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
