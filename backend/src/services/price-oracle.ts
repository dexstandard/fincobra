import NodeCache from 'node-cache';
import { Contract, JsonRpcProvider } from 'ethers';
import type { AbstractProvider } from 'ethers';

import { env } from '../util/env.js';
import type { PriceOracleQuote, SupportedOracleSymbol } from './price-oracle.types.js';

const AGGREGATOR_V3_ABI = [
  'function decimals() view returns (uint8)',
  (
    'function latestRoundData() view returns (uint80 roundId, int256 answer, ' +
    'uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)'
  ),
] as const;

interface OracleFeedConfig {
  address: string;
}

const PRICE_FEEDS: Record<SupportedOracleSymbol, OracleFeedConfig> = {
  USDT: { address: '0x3e7d1eab13ad0104d2750b8863b489d65364e32d' },
  USDC: { address: '0x8fffffd4afb6115b954bd326cbe7b4ba576818f6' },
};

const PRICE_CACHE_TTL_SECONDS = 30;

const priceCache = new NodeCache<PriceOracleQuote>({
  stdTTL: PRICE_CACHE_TTL_SECONDS,
  checkperiod: Math.max(1, Math.ceil(PRICE_CACHE_TTL_SECONDS / 2)),
});

const decimalsCache = new Map<string, number>();
const contractCache = new Map<string, Contract>();

let overrideProvider: AbstractProvider | null = null;
let defaultProvider: JsonRpcProvider | null = null;

function getProvider(): AbstractProvider {
  if (overrideProvider) {
    return overrideProvider;
  }
  if (!env.ETHEREUM_RPC_URL) {
    throw new Error('ETHEREUM_RPC_URL environment variable is not configured');
  }
  if (!defaultProvider) {
    defaultProvider = new JsonRpcProvider(env.ETHEREUM_RPC_URL);
  }
  return defaultProvider;
}

function getFeedContract(address: string): Contract {
  const cached = contractCache.get(address);
  if (cached) return cached;
  const contract = new Contract(address, AGGREGATOR_V3_ABI, getProvider());
  contractCache.set(address, contract);
  return contract;
}

async function getFeedDecimals(contract: Contract, address: string): Promise<number> {
  const cached = decimalsCache.get(address);
  if (typeof cached === 'number') {
    return cached;
  }
  const rawDecimals = await contract.decimals();
  const decimals = typeof rawDecimals === 'number' ? rawDecimals : Number(rawDecimals);
  decimalsCache.set(address, decimals);
  return decimals;
}

interface LatestRoundData {
  answer: bigint;
  updatedAt: bigint;
}

function extractLatestRoundData(raw: any): LatestRoundData {
  const answer =
    typeof raw?.answer === 'bigint'
      ? raw.answer
      : Array.isArray(raw)
        ? (raw[1] as bigint | undefined)
        : undefined;
  const updatedAt =
    typeof raw?.updatedAt === 'bigint'
      ? raw.updatedAt
      : Array.isArray(raw)
        ? (raw[3] as bigint | undefined)
        : undefined;

  if (typeof answer !== 'bigint' || typeof updatedAt !== 'bigint') {
    throw new Error('Unexpected response from price oracle feed');
  }

  return { answer, updatedAt };
}

async function fetchQuoteFromOracle(symbol: SupportedOracleSymbol): Promise<PriceOracleQuote> {
  const { address } = PRICE_FEEDS[symbol];
  const contract = getFeedContract(address);
  const decimals = await getFeedDecimals(contract, address);
  const latestRound = extractLatestRoundData(await contract.latestRoundData());

  if (latestRound.answer <= 0n) {
    throw new Error(`Oracle price for ${symbol} is not positive`);
  }
  if (latestRound.updatedAt === 0n) {
    throw new Error(`Oracle price for ${symbol} is stale`);
  }

  const price = Number(latestRound.answer) / 10 ** decimals;
  const updatedAtMs = Number(latestRound.updatedAt) * 1000;
  if (!Number.isFinite(price) || Number.isNaN(price)) {
    throw new Error(`Failed to parse oracle price for ${symbol}`);
  }

  return {
    symbol,
    price,
    updatedAt: new Date(updatedAtMs),
  };
}

export async function getUsdPrice(symbol: SupportedOracleSymbol): Promise<PriceOracleQuote> {
  const cacheKey = `price:${symbol}`;
  const cached = priceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const quote = await fetchQuoteFromOracle(symbol);
  priceCache.set(cacheKey, quote);
  return quote;
}

export function setPriceOracleProvider(provider: AbstractProvider | null): void {
  overrideProvider = provider;
  priceCache.flushAll();
  decimalsCache.clear();
  contractCache.clear();
  if (provider === null) {
    defaultProvider = null;
  }
}

export function clearPriceOracleCache(): void {
  priceCache.flushAll();
}
