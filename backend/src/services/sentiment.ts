import type { FearGreedIndex } from './sentiment.types.js';

interface FearGreedResponseEntry {
  value: string;
  value_classification: string;
}

interface FearGreedResponse {
  data?: FearGreedResponseEntry[];
  value?: string;
  value_classification?: string;
}

export async function fetchFearGreedIndex(): Promise<FearGreedIndex> {
  const res = await fetch('https://api.alternative.me/fng/');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`failed to fetch fear & greed index: ${res.status} ${body}`);
  }
  const json = (await res.json()) as FearGreedResponse;
  const value = Number(json?.data?.[0]?.value ?? json?.value);
  const classification =
    json?.data?.[0]?.value_classification ?? json?.value_classification ?? '';
  return { value, classification };
}

export type { FearGreedIndex } from './sentiment.types.js';
