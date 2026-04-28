import { ExposureBucket, ExposureSummary, PaperPosition } from "../types";

export interface ProspectiveExposure {
  totalExposureUsd: number;
  marketExposureUsd: number;
  traderExposureUsd: number;
  categoryExposureUsd: number;
  marketCategory: string;
}

export function buildExposureSummary(
  positions: PaperPosition[],
  portfolioValueUsd: number
): ExposureSummary {
  const denominator = Math.max(1, portfolioValueUsd);
  const totalExposureUsd = round(positions.reduce((total, position) => total + position.costBasisUsd, 0));

  return {
    totalExposureUsd,
    totalExposurePct: round(totalExposureUsd / denominator),
    byMarket: buildBuckets(positions, denominator, marketKey, marketLabel),
    byTrader: buildBuckets(positions, denominator, traderKey, traderLabel),
    byCategory: buildBuckets(positions, denominator, categoryKey, categoryLabel)
  };
}

export function calculateProspectiveExposure(input: {
  positions: PaperPosition[];
  conditionId: string;
  marketTitle?: string;
  marketSlug?: string;
  traderWallet?: string;
  traderName?: string;
  tradeUsd: number;
}): ProspectiveExposure {
  const marketCategory = classifyMarketCategory(input.marketTitle, input.marketSlug);
  const totalExposureUsd = sumExposure(input.positions) + input.tradeUsd;
  const marketExposureUsd = sumExposure(input.positions.filter((position) => position.conditionId === input.conditionId)) + input.tradeUsd;
  const traderExposureUsd =
    sumExposure(input.positions.filter((position) => traderKey(position) === traderKeyFromInput(input.traderWallet, input.traderName))) +
    input.tradeUsd;
  const categoryExposureUsd =
    sumExposure(input.positions.filter((position) => categoryKey(position) === marketCategory)) + input.tradeUsd;

  return {
    totalExposureUsd: round(totalExposureUsd),
    marketExposureUsd: round(marketExposureUsd),
    traderExposureUsd: round(traderExposureUsd),
    categoryExposureUsd: round(categoryExposureUsd),
    marketCategory
  };
}

export function classifyMarketCategory(title?: string, slug?: string): string {
  const text = `${title ?? ""} ${slug ?? ""}`.toLowerCase();
  if (/\b(bitcoin|btc|ethereum|eth|crypto|solana|xrp|doge)\b/.test(text)) return "crypto";
  if (/\b(nba|nfl|mlb|nhl|ufc|soccer|football|tennis|world cup|spread:|vs\.)\b/.test(text)) return "sports";
  if (/\b(election|senate|president|trump|biden|congress|minister|war|ceasefire)\b/.test(text)) return "politics";
  if (/\b(fed|interest rate|cpi|inflation|recession|unemployment|gdp)\b/.test(text)) return "macro";
  return "other";
}

function buildBuckets(
  positions: PaperPosition[],
  denominator: number,
  keyFor: (position: PaperPosition) => string,
  labelFor: (position: PaperPosition) => string
): ExposureBucket[] {
  const buckets = new Map<string, ExposureBucket>();
  for (const position of positions) {
    const key = keyFor(position);
    const existing = buckets.get(key) ?? {
      key,
      label: labelFor(position),
      exposureUsd: 0,
      percentOfPortfolio: 0,
      positions: 0
    };
    existing.exposureUsd = round(existing.exposureUsd + position.costBasisUsd);
    existing.percentOfPortfolio = round(existing.exposureUsd / denominator);
    existing.positions += 1;
    buckets.set(key, existing);
  }
  return [...buckets.values()].sort((a, b) => b.exposureUsd - a.exposureUsd);
}

function sumExposure(positions: PaperPosition[]): number {
  return positions.reduce((total, position) => total + position.costBasisUsd, 0);
}

function marketKey(position: PaperPosition): string {
  return position.conditionId || position.marketSlug || "unknown-market";
}

function marketLabel(position: PaperPosition): string {
  return position.marketTitle || position.marketSlug || position.conditionId || "Unknown market";
}

function traderKey(position: PaperPosition): string {
  return traderKeyFromInput(position.traderWallet, position.traderCopied);
}

function traderKeyFromInput(wallet?: string, name?: string): string {
  return wallet || name || "unknown-trader";
}

function traderLabel(position: PaperPosition): string {
  return position.traderCopied || position.traderWallet || "Unknown trader";
}

function categoryKey(position: PaperPosition): string {
  return position.marketCategory || classifyMarketCategory(position.marketTitle, position.marketSlug);
}

function categoryLabel(position: PaperPosition): string {
  const key = categoryKey(position);
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
