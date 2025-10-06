export const HALF_LIFE_MS = 6 * 60 * 60 * 1000;

export const REPUTATION_SCORES: Record<string, number> = {
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

export interface DerivedItem {
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
    regex:
      /\b(hack(ed|ing)?|exploit(ed|ing)?|breach|attack(ed)?|drain(ed)?|rug ?pull|vuln(erability)?|stolen|theft|phish(ed|ing))\b/i,
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
    regex:
      /\b(outage|halt(ed)?|pause(d|s)?|suspend(ed|s|sion)|downtime|disruption|congestion|degrad(ed|ing)?)\b/i,
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
    regex:
      /\b(list(s|ed|ing)?|trading (pair|starts?|opens?))\b.*\b(binance|coinbase|kraken|okx|bybit)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.6,
    baseConfidence: 0.85,
  },
  {
    id: 'R.L2',
    eventType: 'Listing',
    regex:
      /\b(binance|coinbase|kraken|okx|bybit)\b.*\b(list(s|ed|ing)?|trading (pair|starts?|opens?))\b/i,
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
    regex:
      /\b(sec|cftc|fca|esma|doj|finma|mas)\b.*\b(lawsuit|sue(d)?|settlement|fine(d)?|charge(d)?|ban(ned)?|enforcement)\b/i,
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
    baseConfidence: 0.8,
  },
  {
    id: 'R.M1',
    eventType: 'Macro',
    regex:
      /\b(inflation|cpi|jobs report|fomc|fed|interest rate|yields?|usd|treasury|gdp|economy|economic data)\b/i,
    basePolarity: 'neutral',
    baseSeverity: 0.4,
    baseConfidence: 0.6,
  },
  {
    id: 'R.W1',
    eventType: 'WhaleMove',
    regex: /\b(whale|transfer(ed|s)?|moved|on-chain|wallet|address)\b/i,
    basePolarity: 'neutral',
    baseSeverity: 0.5,
    baseConfidence: 0.6,
  },
  {
    id: 'R.W2',
    eventType: 'WhaleMove',
    regex: /\b(\d[\d,.]{2,})\s*(btc|eth|sol|usdt|usdc)\b/i,
    basePolarity: 'neutral',
    baseSeverity: 0.45,
    baseConfidence: 0.7,
  },
  {
    id: 'R.A1',
    eventType: 'Airdrop',
    regex: /\b(airdrop|token distribution|retroactive reward)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.45,
    baseConfidence: 0.65,
  },
  {
    id: 'R.F1',
    eventType: 'Funding',
    regex: /\b(raises?|funding|seed round|series [abc])\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.45,
    baseConfidence: 0.6,
  },
  {
    id: 'R.P1',
    eventType: 'Partnership',
    regex: /\b(partner(ship)?|collaborat(e|ion|es)|integrat(e|ion))\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.45,
    baseConfidence: 0.6,
  },
  {
    id: 'R.UP1',
    eventType: 'Upgrade',
    regex: /\b(upgrade|update|fork|hard fork|soft fork|mainnet|testnet)\b/i,
    basePolarity: 'neutral',
    baseSeverity: 0.4,
    baseConfidence: 0.6,
  },
  {
    id: 'R.LN1',
    eventType: 'Launch',
    regex: /\b(launch(es|ed|ing)?|debut|rollout)\b/i,
    basePolarity: 'bullish',
    baseSeverity: 0.45,
    baseConfidence: 0.6,
  },
  {
    id: 'R.R1',
    eventType: 'Rumor',
    regex:
      /\b(rumor|rumour|unconfirmed|reportedly|according to (social media|sources))\b/i,
    basePolarity: 'neutral',
    baseSeverity: 0.2,
    baseConfidence: 0.5,
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getReputation(domain: string | null): number {
  if (!domain) return 0;
  return REPUTATION_SCORES[domain] ?? 0;
}

export function computeTimeDecay(pubDate: string | null, now: Date): number {
  if (!pubDate) return 0;
  const publishedMs = Date.parse(pubDate);
  if (Number.isNaN(publishedMs)) return 0;
  const ageMs = now.getTime() - publishedMs;
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

export function computeDerivedItem(item: {
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
  const hasNegative = negativeBuckets.some(
    (type) => (matchesByType.get(type) ?? []).length > 0,
  );
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

  if (eventType === 'WhaleMove') {
    const depositLike = /(deposit|inflow|transfer(ed|s)?)/.test(titleLower);
    const withdrawLike = /(withdraw|withdrawal|outflow|redeem)/.test(titleLower);
    if (depositLike) {
      polarity = 'bearish';
    } else if (withdrawLike) {
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
  };
}

export function sortDerivedItems(items: DerivedItem[]): DerivedItem[] {
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

export function computeWeight(
  domain: string | null,
  pubDate: string | null,
  now: Date,
): number {
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
