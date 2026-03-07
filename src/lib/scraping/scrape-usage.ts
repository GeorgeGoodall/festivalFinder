export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface UsageSummary {
  totalCalls: number;
  filterLinksCalls: number;
  classifyPageCalls: number;
  extractionCalls: number;
  inferRegionCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costGbp: number;
}

// Pricing per million tokens (USD)
const HAIKU_INPUT_PER_M = 0.8;
const HAIKU_OUTPUT_PER_M = 4.0;
const SONNET_INPUT_PER_M = 3.0;
const SONNET_OUTPUT_PER_M = 15.0;
const USD_TO_GBP = 0.79;

function computeCost(inputTokens: number, outputTokens: number, model: string): number {
  const isHaiku = model.toLowerCase().includes("haiku");
  const inputCost = (inputTokens / 1_000_000) * (isHaiku ? HAIKU_INPUT_PER_M : SONNET_INPUT_PER_M);
  const outputCost = (outputTokens / 1_000_000) * (isHaiku ? HAIKU_OUTPUT_PER_M : SONNET_OUTPUT_PER_M);
  return inputCost + outputCost;
}

export class CrawlUsageTracker {
  private filterLinksUsages: AiUsage[] = [];
  private classifyPageUsages: AiUsage[] = [];
  private extractionUsages: AiUsage[] = [];
  private inferRegionUsages: AiUsage[] = [];

  addFilterLinks(usage: AiUsage): void {
    this.filterLinksUsages.push(usage);
  }

  addClassifyPage(usage: AiUsage): void {
    this.classifyPageUsages.push(usage);
  }

  addExtraction(usage: AiUsage): void {
    this.extractionUsages.push(usage);
  }

  addInferRegion(usage: AiUsage): void {
    this.inferRegionUsages.push(usage);
  }

  getSummary(): UsageSummary {
    const allUsages = [
      ...this.filterLinksUsages,
      ...this.classifyPageUsages,
      ...this.extractionUsages,
      ...this.inferRegionUsages,
    ];

    const inputTokens = allUsages.reduce((sum, u) => sum + u.inputTokens, 0);
    const outputTokens = allUsages.reduce((sum, u) => sum + u.outputTokens, 0);
    const costUsd = allUsages.reduce(
      (sum, u) => sum + computeCost(u.inputTokens, u.outputTokens, u.model),
      0
    );

    return {
      totalCalls: allUsages.length,
      filterLinksCalls: this.filterLinksUsages.length,
      classifyPageCalls: this.classifyPageUsages.length,
      extractionCalls: this.extractionUsages.length,
      inferRegionCalls: this.inferRegionUsages.length,
      inputTokens,
      outputTokens,
      costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
      costGbp: Math.round(costUsd * USD_TO_GBP * 1_000_000) / 1_000_000,
    };
  }
}
