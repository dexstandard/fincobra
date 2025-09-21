import type { FastifyBaseLogger } from 'fastify';
import { getNewsByToken } from '../repos/news.js';
import { insertReviewRawLog } from '../repos/review-raw-log.js';
import { callAi, extractJson } from '../util/ai.js';
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
  const items = await getNewsByToken(token, 5);
  if (!items.length) return { analysis: null };
  const headlines = items.map((i) => `- ${i.title} (${i.link})`).join('\n');
  const prompt = { headlines };
  const instructions =
    `You are a crypto market news analyst. Given the headlines, estimate the overall news tone for ${token}. Include a bullishness score from 0-10 and highlight key events. - shortReport ≤255 chars.`;
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
      log.error({ token, response: res }, 'news analyst returned invalid response');
      return { analysis: fallback, prompt: { instructions, input: prompt }, response: res };
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
      const { analysis, prompt: p, response } =
        await getTokenNewsSummaryCached(token, model, apiKey, log);
      if (p && response)
        await insertReviewRawLog({ portfolioWorkflowId: portfolioId, prompt: p, response });
      report.news = analysis;
    }),
  );
}
