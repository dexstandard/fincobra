import type { FastifyBaseLogger } from 'fastify';
import { fetchNews } from '../services/news.js';
import { insertNews } from '../repos/news.js';

function summarizeNewsByToken(news: { tokens: string[] }[]) {
  const counts: Record<string, number> = {};
  for (const item of news) {
    for (const token of item.tokens) {
      counts[token] = (counts[token] ?? 0) + 1;
    }
  }
  return counts;
}

export default async function fetchNewsJob(log: FastifyBaseLogger) {
  try {
    const news = await fetchNews();
    await insertNews(news);
    const perToken = summarizeNewsByToken(news);
    log.info({ total: news.length, perToken }, 'fetched news batch');
  } catch (err) {
    log.error({ err }, 'failed to fetch news');
  }
}
