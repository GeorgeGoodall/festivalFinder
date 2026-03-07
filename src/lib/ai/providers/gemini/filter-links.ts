import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionCallingMode,
} from "@google/generative-ai";
import type { AiUsage } from "@/lib/scraping/scrape-usage";

export interface LinkCandidate {
  url: string;
  text: string;
  context: string;
}

export interface FilterLinksResult {
  selectedIndices: number[];
  selected: LinkCandidate[];
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
          name: "select_relevant_links",
          description:
            "Select the indices of links that are relevant to discovering festival information.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              relevant_indices: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.NUMBER },
                description: "Array of indices of relevant links",
              },
            },
            required: ["relevant_indices"],
          },
        },
      ],
    },
  ],
  toolConfig: {
    functionCallingConfig: {
      mode: FunctionCallingMode.ANY,
      allowedFunctionNames: ["select_relevant_links"],
    },
  },
});

export async function filterLinksForFestival(
  links: LinkCandidate[]
): Promise<FilterLinksResult> {
  if (links.length === 0) {
    return {
      selectedIndices: [],
      selected: [],
      usage: { inputTokens: 0, outputTokens: 0, model: MODEL },
    };
  }

  const numberedList = links
    .map(
      (link, i) =>
        `[${i}] URL: ${link.url} Text: "${link.text}" Context: "${link.context}"`
    )
    .join("\n");

  const result = await model.generateContent(
    `You are filtering links found on a music festival website. Select the links most likely to lead to useful festival information.

INCLUDE links leading to:
- Lineup / artists / performers / acts
- About / info pages
- Tickets
- Programme / schedule / stages / days

EXCLUDE links leading to:
- Contact, privacy, terms, news, blog, press, careers
- Login, shop/merch, social media
- Accessibility, FAQs, cookies

When unsure, include the link (false positives are cheap).

Here are the links:
${numberedList}`
  );

  const call = result.response.functionCalls()?.[0];
  let selectedIndices: number[] = [];
  if (call) {
    const input = call.args as { relevant_indices: number[] };
    selectedIndices = input.relevant_indices.filter(
      (i) => Number.isInteger(i) && i >= 0 && i < links.length
    );
  }

  const selected = selectedIndices.map((i) => links[i]);

  return {
    selectedIndices,
    selected,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      model: MODEL,
    },
  };
}
