import Groq from 'groq-sdk';

const MODEL_NAME = 'groq/compound';
const DEFAULT_TEMPERATURE = 0.2;

export const NEWS_AGENT_EVENT_TYPES = [
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
] as const;

export type NewsAgentEventType = (typeof NEWS_AGENT_EVENT_TYPES)[number];
export type NewsAgentSentiment = 'bullish' | 'bearish' | 'neutral';

export interface NewsAgentInput {
  headline: string;
  summary?: string | null;
  body?: string | null;
  link?: string | null;
  domain?: string | null;
  tokens?: string[];
  publishedAt?: string | null;
  sentimentHint?: NewsAgentSentiment | null;
  categoryHint?: NewsAgentEventType | null;
}

interface NewsAgentRawResponse {
  category: string;
  categoryConfidence: number;
  sentiment: string;
  sentimentConfidence: number;
  severity: number;
  novelty: number;
  timeSensitivity: number;
  priority: number;
  reasoning: string;
  riskNotes?: string | null;
  tags?: unknown;
}

export interface NewsAgentAnalysis {
  category: NewsAgentEventType;
  categoryConfidence: number;
  sentiment: NewsAgentSentiment;
  sentimentConfidence: number;
  severity: number;
  novelty: number;
  timeSensitivity: number;
  priority: number;
  reasoning: string;
  riskNotes: string | null;
  tags: string[];
  raw: unknown;
}

export const newsAgentInstructions = [
  'You are FinCobra\'s automated crypto news agent.',
  'Classify the primary risk event in each headline using the provided categories.',
  'Estimate impact severity, novelty, time sensitivity, and the confidence of your classification.',
  'Provide concise risk notes only when additional context is necessary.',
  'Work strictly within the JSON schema. Return scores between 0 and 1 for all probability-style metrics.',
  '',
  'Event categories:',
  ...NEWS_AGENT_EVENT_TYPES.map((type) => `- ${type}`),
].join('\n');

export const newsAgentResponseSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...NEWS_AGENT_EVENT_TYPES] },
    categoryConfidence: { type: 'number', minimum: 0, maximum: 1 },
    sentiment: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
    sentimentConfidence: { type: 'number', minimum: 0, maximum: 1 },
    severity: { type: 'number', minimum: 0, maximum: 1 },
    novelty: { type: 'number', minimum: 0, maximum: 1 },
    timeSensitivity: { type: 'number', minimum: 0, maximum: 1 },
    priority: { type: 'integer', minimum: 1, maximum: 5 },
    reasoning: { type: 'string' },
    riskNotes: { type: 'string' },
    tags: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'category',
    'categoryConfidence',
    'sentiment',
    'sentimentConfidence',
    'severity',
    'novelty',
    'timeSensitivity',
    'priority',
    'reasoning',
  ],
  additionalProperties: false,
} as const;

interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
  temperature?: number;
  response_format: {
    type: 'json_schema';
    json_schema: {
      name: string;
      strict: true;
      schema: typeof newsAgentResponseSchema;
    };
  };
}

interface ChatCompletionResult {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
  }>;
}

interface GroqLikeClient {
  chat: {
    completions: {
      create: (params: ChatCompletionRequest) => Promise<ChatCompletionResult>;
    };
  };
}

export interface RunNewsAgentOptions {
  client?: GroqLikeClient;
  apiKey?: string;
  temperature?: number;
}

function createGroqClient(apiKey: string): GroqLikeClient {
  return new Groq({ apiKey });
}

function resolveApiKey(explicit?: string): string {
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }
  const systemKey = process.env.GROQ_SYSTEM_API_KEY;
  if (systemKey && systemKey.trim()) {
    return systemKey.trim();
  }
  const fallback = process.env.GROQ_API_KEY;
  if (fallback && fallback.trim()) {
    return fallback.trim();
  }
  throw new Error('GROQ system API key is not configured');
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of tags) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalizePriority(value: number): number {
  if (!Number.isFinite(value)) return 3;
  const clamped = Math.round(value);
  if (clamped < 1) return 1;
  if (clamped > 5) return 5;
  return clamped;
}

function resolveCategory(value: string): NewsAgentEventType {
  const normalized = value.trim();
  const exact = NEWS_AGENT_EVENT_TYPES.find((type) => type === normalized);
  if (exact) return exact;
  const lower = normalized.toLowerCase();
  const match = NEWS_AGENT_EVENT_TYPES.find(
    (type) => type.toLowerCase() === lower,
  );
  if (!match) {
    throw new Error(`Unsupported category from news agent: ${value}`);
  }
  return match;
}

function resolveSentiment(value: string): NewsAgentSentiment {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'bullish' || normalized === 'bearish' || normalized === 'neutral') {
    return normalized;
  }
  throw new Error(`Unsupported sentiment from news agent: ${value}`);
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`News agent response is missing numeric field: ${field}`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`News agent response is missing string field: ${field}`);
  }
  return value;
}

function uppercaseTokens(tokens: string[] | undefined): string[] | undefined {
  if (!tokens) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (typeof token !== 'string') continue;
    const trimmed = token.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();
    if (seen.has(upper)) continue;
    seen.add(upper);
    out.push(upper);
  }
  return out.length ? out : undefined;
}

export function buildNewsAgentUserContent(input: NewsAgentInput): string {
  const payload: Record<string, unknown> = {
    headline: requireString(input.headline, 'headline'),
    summary: input.summary ?? null,
    body: input.body ?? null,
    link: input.link ?? null,
    domain: input.domain ?? null,
    publishedAt: input.publishedAt ?? null,
  };

  const tokens = uppercaseTokens(input.tokens);
  if (tokens) {
    payload.referencedSymbols = tokens;
  }
  if (input.sentimentHint) {
    payload.sentimentHint = input.sentimentHint;
  }
  if (input.categoryHint) {
    payload.categoryHint = input.categoryHint;
  }

  return JSON.stringify(payload);
}

export function parseNewsAgentContent(content: string): NewsAgentAnalysis {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('News agent returned an empty body');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error('News agent returned invalid JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error('News agent returned an unexpected structure');
  }

  const raw = parsed as Partial<NewsAgentRawResponse>;
  const category = resolveCategory(requireString(raw.category, 'category'));
  const sentiment = resolveSentiment(
    requireString(raw.sentiment, 'sentiment'),
  );
  const categoryConfidence = clampUnit(
    requireNumber(raw.categoryConfidence, 'categoryConfidence'),
  );
  const sentimentConfidence = clampUnit(
    requireNumber(raw.sentimentConfidence, 'sentimentConfidence'),
  );
  const severity = clampUnit(requireNumber(raw.severity, 'severity'));
  const novelty = clampUnit(requireNumber(raw.novelty, 'novelty'));
  const timeSensitivity = clampUnit(
    requireNumber(raw.timeSensitivity, 'timeSensitivity'),
  );
  const priority = normalizePriority(requireNumber(raw.priority, 'priority'));
  const reasoning = requireString(raw.reasoning, 'reasoning').trim();
  const riskNotes = optionalString(raw.riskNotes);
  const tags = sanitizeTags(raw.tags);

  return {
    category,
    categoryConfidence,
    sentiment,
    sentimentConfidence,
    severity,
    novelty,
    timeSensitivity,
    priority,
    reasoning,
    riskNotes,
    tags,
    raw,
  };
}

export async function runNewsAgent(
  input: NewsAgentInput,
  options: RunNewsAgentOptions = {},
): Promise<NewsAgentAnalysis> {
  const { client, temperature = DEFAULT_TEMPERATURE } = options;
  const resolvedClient =
    client ?? createGroqClient(resolveApiKey(options.apiKey));

  const request: ChatCompletionRequest = {
    model: MODEL_NAME,
    messages: [
      { role: 'system', content: newsAgentInstructions },
      { role: 'user', content: buildNewsAgentUserContent(input) },
    ],
    temperature,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'news_agent_response',
        strict: true,
        schema: newsAgentResponseSchema,
      },
    },
  };

  const completion = await resolvedClient.chat.completions.create(request);
  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('News agent returned an empty message');
  }
  return parseNewsAgentContent(content);
}

