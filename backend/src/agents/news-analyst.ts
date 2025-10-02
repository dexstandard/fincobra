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

  log.info(
    {
      token,
      selectedNews: weighted.map((item) => ({
        title: item.title,
        domain: item.domain,
        pubDate: item.pubDate,
        weight: item.weight,
      })),
    },
    'selected news items for analysis',
  );

  const headlines = weighted.map((i) => `- ${i.title} (${i.link})`).join('\n');
  const prompt = { headlines };
  const instructions = `You are a crypto market news analyst. Given the headlines, estimate the overall news tone for ${token}. Include a bullishness score from 0-10 and highlight key events. - shortReport ≤255 chars.`;
  const fallback: Analysis = { comment: 'Analysis unavailable', score: 0 };
  try {
    const res = await callAi(
      model,
      instructions,
      analysisSchema,
      prompt,
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
        prompt: { instructions, input: prompt },
        response: res,
      };
    }
    return { analysis, prompt: { instructions, input: prompt }, response: res };
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
