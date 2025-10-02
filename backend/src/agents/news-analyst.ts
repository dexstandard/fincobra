import type { FastifyBaseLogger } from 'fastify';
import { getNewsByToken } from '../repos/news.js';
import { insertReviewRawLog } from '../repos/review-raw-log.js';
import { callAi, extractJson } from '../services/openai-client.js';
import { isStablecoin } from '../util/tokens.js';
import type { RebalancePrompt, RunParams } from './main-trader.types.js';
import {
  type AnalysisLog,
  type Analysis,
  analysisSchema,
} from './news-analyst.types.js';

const CACHE_MS = 3 * 60 * 1000;
const cache = new Map<
  string,
  { promise: Promise<AnalysisLog>; expires: number }
>();

const HALF_LIFE_MS = 6 * 60 * 60 * 1000;

const REPUTATION_SCORES: Record<string, number> = {
  'coindesk.com': 0.95,
  'cointelegraph.com': 0.65,
  'bitcoinist.com': 0.58,
  'cryptopotato.com': 0.6,
  'news.bitcoin.com': 0.5,
};

type EventType =
  | 'Hack'
  | 'StablecoinDepeg'
  | 'Outage'
  | 'Delisting'
  | 'Listing'
  | 'Unlock'
  | 'Regulation'
  | 'ETF'
  | 'Macro'
  | 'WhaleMove'
  | 'Airdrop'
  | 'Funding'
  | 'Partnership'
  | 'Upgrade'
  | 'Launch'
  | 'Rumor'
  | 'Other';

type Polarity = 'bullish' | 'bearish' | 'neutral';

interface Rule {
  id: string;
  eventType: EventType;
  regex: RegExp;
  basePolarity: Polarity;
  baseSeverity: number;
  baseConfidence: number;
}

interface DerivedNumbers {
  usdApprox: number | null;
  tokenQtyApprox: number | null;
  tokenUnit?: 'BTC' | 'ETH' | 'SOL' | 'USDT' | 'USDC';
}

interface TierHints {
  exchangeTier: 'T1' | 'T2' | 'none';
  exchange?: 'binance' | 'coinbase' | 'kraken' | 'okx' | 'bybit';
}

interface DerivedItem {
  title: string;
  link: string | null;
  pubDate: string | null;
  domain: string | null;
  weight: number;
  eventType: EventType;
  polarity: Polarity;
  severity: number;
  eventConfidence: number;
  headlineScore: number;
  matchedRules: string[];
  numbers: DerivedNumbers;
  tierHints: TierHints;
}

const EVENT_PRIORITY: EventType[] = [
  'Hack',
  'StablecoinDepeg',
  'Outage',
  'Delisting',
  'Listing',
  'Unlock',
  'Regulation',
  'ETF',
  'Macro',
  'WhaleMove',
  'Airdrop',
  'Funding',
  'Partnership',
  'Upgrade',
  'Launch',
  'Rumor',
  'Other',
];

const RULES: Rule[] = [
  {
    id: 'R.H1',
    eventType: 'Hack',
    regex: /\b(hack(ed|ing)?|exploit(ed|ing)?|breach|attack(ed)?|drain(ed)?|rug ?pull|vuln(erability)?|stolen|theft|phish(ed|ing))\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.8,
    baseConfidence: 0.9,
  },
  {
    id: 'R.SD1',
    eventType: 'StablecoinDepeg',
    regex: /\b(depeg(ged|ging|s)?|unpeg(ged|s)?|off[- ]?peg)\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.75,
    baseConfidence: 0.85,
  },
  {
    id: 'R.SD2',
    eventType: 'StablecoinDepeg',
    regex: /\b(reserve(s)? (issue|shortfall|problem)|collateral (issue|risk))\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.65,
    baseConfidence: 0.75,
  },
  {
    id: 'R.O1',
    eventType: 'Outage',
    regex: /\b(outage|halt(ed)?|pause(d|s)?|suspend(ed|s|sion)|downtime|disruption|congestion|degrad(ed|ing)?)\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.7,
    baseConfidence: 0.8,
  },
  {
    id: 'R.D1',
    eventType: 'Delisting',
    regex: /\b(delist(s|ed|ing)?|remove(d)? from (trading|exchange))\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.65,
    baseConfidence: 0.85,
  },
  {
    id: 'R.L1',
    eventType: 'Listing',
    regex: /\b(list(s|ed|ing)?|trading (pair|starts?|opens?))\b.*\b(binance|coinbase|kraken|okx|bybit)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.6,
    baseConfidence: 0.85,
  },
  {
    id: 'R.L2',
    eventType: 'Listing',
    regex: /\b(binance|coinbase|kraken|okx|bybit)\b.*\b(list(s|ed|ing)?|trading (pair|starts?|opens?))\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.6,
    baseConfidence: 0.85,
  },
  {
    id: 'R.U1',
    eventType: 'Unlock',
    regex: /\b(unlock(s|ed|ing)?|vesting|cliff)\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.6,
    baseConfidence: 0.8,
  },
  {
    id: 'R.REG1',
    eventType: 'Regulation',
    regex: /\b(sec|cftc|fca|esma|doj|finma|mas)\b.*\b(lawsuit|sue(d)?|settlement|fine(d)?|charge(d)?|ban(ned)?|enforcement)\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.7,
    baseConfidence: 0.85,
  },
  {
    id: 'R.REG2',
    eventType: 'Regulation',
    regex: /\b(license|registered|authorization|green ?light)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.55,
    baseConfidence: 0.7,
  },
  {
    id: 'R.ETF1',
    eventType: 'ETF',
    regex: /\b(etf|spot etf|futures etf)\b.*\b(approval|approved)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.65,
    baseConfidence: 0.85,
  },
  {
    id: 'R.ETF2',
    eventType: 'ETF',
    regex: /\b(etf|spot etf|futures etf)\b.*\b(deny|denied|rejected|delay(ed)?)\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.6,
    baseConfidence: 0.85,
  },
  {
    id: 'R.M1',
    eventType: 'Macro',
    regex: /\b(fed|fomc|ecb|boe|rate(s)? (hike|rise|increase))\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.55,
    baseConfidence: 0.75,
  },
  {
    id: 'R.M2',
    eventType: 'Macro',
    regex: /\b(fed|fomc|ecb|boe|rate(s)? (cut|decrease|reduce))\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.55,
    baseConfidence: 0.75,
  },
  {
    id: 'R.M3',
    eventType: 'Macro',
    regex: /\b(cpi|inflation)\b.*\b(higher|hot|beat(s)? expectations)\b/i,
    basePolarity: 'bearish',
    baseSeverity: 0.55,
    baseConfidence: 0.7,
  },
  {
    id: 'R.M4',
    eventType: 'Macro',
    regex: /\b(cpi|inflation)\b.*\b(lower|cool|miss(es)? expectations)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.55,
    baseConfidence: 0.7,
  },
  {
    id: 'R.W1',
    eventType: 'WhaleMove',
    regex: /\b(whale|large)\b.*\b(transfer|move|deposit|withdraw(al|n)|inflow|outflow)s?\b/i,
    basePolarity: 'neutral',
    baseSeverity: 0.5,
    baseConfidence: 0.7,
  },
  {
    id: 'R.A1',
    eventType: 'Airdrop',
    regex: /\b(airdrop|retroactive distribution|claim window)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.45,
    baseConfidence: 0.7,
  },
  {
    id: 'R.F1',
    eventType: 'Funding',
    regex: /\b(raise(d)?|funding|round|series (a|b|c|d)|valuation)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.5,
    baseConfidence: 0.75,
  },
  {
    id: 'R.P1',
    eventType: 'Partnership',
    regex: /\b(partner(ship)?|collaborat(e|ion)|integrat(e|ion)|adopt(s|ion))\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.5,
    baseConfidence: 0.7,
  },
  {
    id: 'R.UPG1',
    eventType: 'Upgrade',
    regex: /\b(upgrade|hardfork|softfork|eip-\d+|protocol update)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.45,
    baseConfidence: 0.7,
  },
  {
    id: 'R.LCH1',
    eventType: 'Launch',
    regex: /\b(mainnet|testnet|launch(ed)?|go(es)? live|deployment|release(d)?)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.45,
    baseConfidence: 0.7,
  },
  {
    id: 'R.R1',
    eventType: 'Rumor',
    regex: /\b(rumor|rumour|unconfirmed|reportedly|according to (social media|sources))\b/i,
    basePolarity: 'neutral',
    baseSeverity: 0.2,
    baseConfidence: 0.5,
  },
];

const EXCHANGE_REGEX = /\b(binance|coinbase|kraken|okx|bybit)\b/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getReputation(domain: string | null): number {
  if (!domain) return 0;
  return REPUTATION_SCORES[domain] ?? 0;
}

function parseUsdAmount(title: string): number | null {
  const match = title.match(/\$[0-9][0-9,\.]*\s?(million|billion|m|bn|b)?/i);
  if (!match) return null;
  const raw = match[0].toLowerCase();
  const numberMatch = raw.match(/\$([0-9][0-9,\.]*)/);
  if (!numberMatch) return null;
  const base = Number(numberMatch[1].replace(/,/g, ''));
  if (Number.isNaN(base)) return null;
  let multiplier = 1;
  if (raw.includes('billion') || /bn\b/.test(raw) || raw.trim().endsWith('b')) {
    multiplier = 1_000_000_000;
  } else if (raw.includes('million') || /m\b/.test(raw) || raw.trim().endsWith('m')) {
    multiplier = 1_000_000;
  }
  return base * multiplier;
}

function parseTokenQuantity(
  title: string,
): { amount: number; unit: DerivedNumbers['tokenUnit'] } | null {
  const match = title.match(/(\d[\d,\.]{2,})\s*(btc|eth|sol|usdt|usdc)\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  if (Number.isNaN(amount)) return null;
  const unit = match[2].toUpperCase() as DerivedNumbers['tokenUnit'];
  return { amount, unit };
}

function applyTokenSeverityBoost(
  severity: number,
  token: { amount: number; unit: DerivedNumbers['tokenUnit'] },
): number {
  const { amount, unit } = token;
  if (!unit) return severity;
  if (unit === 'BTC') {
    if (amount >= 1000) return severity + 0.2;
    if (amount >= 200) return severity + 0.1;
  }
  if (unit === 'ETH') {
    if (amount >= 10000) return severity + 0.2;
    if (amount >= 2000) return severity + 0.1;
  }
  if (unit === 'SOL') {
    if (amount >= 100000) return severity + 0.1;
  }
  if (unit === 'USDT' || unit === 'USDC') {
    if (amount >= 50_000_000) return severity + 0.15;
  }
  return severity;
}

function getExchangeTierHints(
  eventType: EventType,
  exchangeMatch: RegExpMatchArray | null,
): TierHints {
  if (!exchangeMatch) return { exchangeTier: 'none' };
  const exchange = exchangeMatch[1].toLowerCase() as TierHints['exchange'];
  if (!['Listing', 'Delisting', 'Outage'].includes(eventType)) {
    return { exchangeTier: 'none' };
  }
  const tier = exchange === 'binance' || exchange === 'coinbase' ? 'T1' : 'T2';
  return { exchangeTier: tier, exchange };
}

function computeDerivedItem(item: {
  title: string;
  link: string | null;
  pubDate: string | null;
  domain: string | null;
  weight: number;
}): DerivedItem {
  const titleLower = item.title.toLowerCase();
  const matchedRules: string[] = [];
  const matchesByType = new Map<EventType, Rule[]>();

  for (const rule of RULES) {
    if (rule.regex.test(titleLower)) {
      matchedRules.push(rule.id);
      const existing = matchesByType.get(rule.eventType) ?? [];
      existing.push(rule);
      matchesByType.set(rule.eventType, existing);
    }
  }

  const negativeBuckets: EventType[] = ['Hack', 'StablecoinDepeg', 'Outage', 'Delisting'];

  let eventType: EventType = 'Other';
  for (const type of EVENT_PRIORITY) {
    if ((matchesByType.get(type) ?? []).length > 0) {
      eventType = type;
      break;
    }
  }

  const rumorRules = matchesByType.get('Rumor') ?? [];
  const hasNegative = negativeBuckets.some((type) => (matchesByType.get(type) ?? []).length > 0);
  let rumorOverride = false;
  if (rumorRules.length && !hasNegative) {
    eventType = 'Rumor';
    rumorOverride = true;
  }

  const eventRules = matchesByType.get(eventType) ?? [];
  let primaryRule: Rule | null = null;
  for (const rule of eventRules) {
    if (!primaryRule || rule.baseConfidence > primaryRule.baseConfidence) {
      primaryRule = rule;
    }
  }

  let polarity: Polarity = primaryRule?.basePolarity ?? 'neutral';
  let severity = primaryRule?.baseSeverity ?? 0.3;
  let eventConfidence = primaryRule?.baseConfidence ?? 0.4;

  const reputation = getReputation(item.domain);
  const rumorMatched = rumorRules.length > 0;
  const hasListing = (matchesByType.get('Listing') ?? []).length > 0;
  const etfRules = matchesByType.get('ETF') ?? [];
  const hasEtfApproval = etfRules.some((rule) => rule.id === 'R.ETF1');

  if (hasNegative) {
    polarity = 'bearish';
  } else if (!rumorOverride && (hasListing || hasEtfApproval)) {
    polarity = 'bullish';
  }

  const exchangeMatch = titleLower.match(EXCHANGE_REGEX);

  if (eventType === 'WhaleMove') {
    const depositLike = /(deposit|inflow|transfer(ed|s)?)/.test(titleLower);
    const withdrawLike = /(withdraw|withdrawal|outflow|redeem)/.test(titleLower);
    if (exchangeMatch && depositLike) {
      polarity = 'bearish';
    } else if (exchangeMatch && withdrawLike) {
      polarity = 'bullish';
    }
  }

  if (eventRules.length >= 2) {
    eventConfidence += 0.05;
  }
  if (reputation >= 0.8) {
    severity += 0.05;
    eventConfidence += 0.05;
  }
  if (rumorMatched) {
    eventConfidence -= 0.1;
  }

  const usdAmount = parseUsdAmount(titleLower);
  const numbers: DerivedNumbers = {
    usdApprox: usdAmount,
    tokenQtyApprox: null,
  };

  if (usdAmount) {
    if (usdAmount >= 5_000_000) severity += 0.2;
    else if (usdAmount >= 1_000_000) severity += 0.1;
  }

  const tokenQuantity = parseTokenQuantity(titleLower);
  if (tokenQuantity) {
    numbers.tokenQtyApprox = tokenQuantity.amount;
    numbers.tokenUnit = tokenQuantity.unit;
    severity = applyTokenSeverityBoost(severity, tokenQuantity);
    matchedRules.push('R.W2');
  }

  const tierHints = getExchangeTierHints(eventType, exchangeMatch);
  if (tierHints.exchangeTier === 'T1') {
    severity += 0.1;
  } else if (tierHints.exchangeTier === 'T2') {
    severity += 0.05;
  }

  if (rumorMatched) {
    severity *= 0.7;
    eventConfidence *= 0.8;
  }

  severity = clamp(severity, 0, 1);
  eventConfidence = clamp(eventConfidence, 0, 1);

  const headlineScore =
    item.weight * (0.6 + 0.4 * severity) * (0.9 + 0.1 * eventConfidence);

  return {
    title: item.title,
    link: item.link,
    pubDate: item.pubDate,
    domain: item.domain,
    weight: item.weight,
    eventType,
    polarity,
    severity,
    eventConfidence,
    headlineScore,
    matchedRules,
    numbers,
    tierHints,
  };
}

function sortDerivedItems(items: DerivedItem[]): DerivedItem[] {
  return [...items].sort((a, b) => {
    const scoreDiff = b.headlineScore - a.headlineScore;
    if (Math.abs(scoreDiff) > 1e-6) return scoreDiff > 0 ? 1 : -1;
    const severityDiff = b.severity - a.severity;
    if (Math.abs(severityDiff) > 1e-6) return severityDiff > 0 ? 1 : -1;
    const aTime = a.pubDate ? Date.parse(a.pubDate) : Number.POSITIVE_INFINITY;
    const bTime = b.pubDate ? Date.parse(b.pubDate) : Number.POSITIVE_INFINITY;
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }
    const repDiff = getReputation(b.domain) - getReputation(a.domain);
    if (Math.abs(repDiff) > 1e-6) return repDiff > 0 ? 1 : -1;
    return 0;
  });
}

function computeWeight(domain: string | null, pubDate: string | null, now: Date): number {
  if (!domain) return 0;
  const reputation = REPUTATION_SCORES[domain] ?? 0;
  if (!reputation) return 0;
  if (!pubDate) return 0;
  const publishedMs = Date.parse(pubDate);
  if (Number.isNaN(publishedMs)) return 0;
  const ageMs = now.getTime() - publishedMs;
  if (ageMs <= 0) return reputation;
  const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
  return reputation * decay;
}

export function getTokenNewsSummaryCached(
  token: string,
  model: string,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<AnalysisLog> {
  const now = Date.now();
  const cached = cache.get(token);
  if (cached && cached.expires > now) {
    log.info({ token }, 'news summary cache hit');
    return cached.promise;
  }
  log.info({ token }, 'news summary cache miss');
  const promise = getTokenNewsSummary(token, model, apiKey, log);
  cache.set(token, { promise, expires: now + CACHE_MS });
  promise.catch(() => cache.delete(token));
  return promise;
}

export async function getTokenNewsSummary(
  token: string,
  model: string,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<AnalysisLog> {
  const items = await getNewsByToken(token, 20);
  if (!items.length) return { analysis: null };
  const now = new Date();
  const weighted = items
    .map((item) => ({ ...item, weight: computeWeight(item.domain, item.pubDate, now) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  if (!weighted.length) {
    return { analysis: null };
  }

  const derived = weighted.map((item) =>
    computeDerivedItem({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      domain: item.domain,
      weight: item.weight,
    }),
  );
  const orderedDerived = sortDerivedItems(derived);

  log.info(
    {
      token,
      selectedNews: orderedDerived.map((item) => ({
        title: item.title,
        domain: item.domain,
        pubDate: item.pubDate,
        weight: item.weight,
        eventType: item.eventType,
        severity: item.severity,
        eventConfidence: item.eventConfidence,
        headlineScore: item.headlineScore,
      })),
    },
    'selected news items for analysis',
  );

  const headlines = orderedDerived.map((i) => `- ${i.title} (${i.link})`).join('\n');
  const promptInput = { headlines };
  const derivedPayload = { items: orderedDerived };
  const instructions = `You are a crypto market news analyst. Given the headlines, estimate the overall news tone for ${token}. Include a bullishness score from 0-10 and highlight key events. - shortReport ≤255 chars.`;
  const fallback: Analysis = { comment: 'Analysis unavailable', score: 0 };
  try {
    const res = await callAi(
      model,
      instructions,
      analysisSchema,
      promptInput,
      apiKey,
      true,
    );
    const analysis = extractJson<Analysis>(res);
    if (!analysis) {
      log.error(
        { token, response: res },
        'news analyst returned invalid response',
      );
      return {
        analysis: fallback,
        prompt: { instructions, input: promptInput, derivedV1: derivedPayload },
        response: res,
      };
    }
    return {
      analysis,
      prompt: { instructions, input: promptInput, derivedV1: derivedPayload },
      response: res,
    };
  } catch (err) {
    log.error({ err, token }, 'news analyst call failed');
    return { analysis: fallback };
  }
}

export async function runNewsAnalyst(
  { log, model, apiKey, portfolioId }: RunParams,
  prompt: RebalancePrompt,
): Promise<void> {
  if (!prompt.reports) return;
  await Promise.all(
    prompt.reports.map(async (report) => {
      const { token } = report;
      if (isStablecoin(token)) return;
      const {
        analysis,
        prompt: p,
        response,
      } = await getTokenNewsSummaryCached(token, model, apiKey, log);
      if (p && response)
        await insertReviewRawLog({
          portfolioWorkflowId: portfolioId,
          prompt: p,
          response,
        });
      report.news = analysis;
    }),
  );
}
