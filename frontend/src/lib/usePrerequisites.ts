import axios from 'axios';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from './axios';
import { useUser } from './useUser';
import { useBinanceAccount } from './useBinanceAccount';
import { useBybitFuturesBalance } from './useBybitFuturesBalance';

export interface BalanceInfo {
  token: string;
  isLoading: boolean;
  walletBalance: number;
  earnBalance: number;
  usdValue: number;
}

interface UsePrerequisitesOptions {
  includeAiKey?: boolean;
  exchange?: 'binance' | 'bybit';
}

interface ExchangeKeySummary {
  id: string;
}

export function usePrerequisites(
  tokens: string[],
  options?: UsePrerequisitesOptions,
) {
  const { includeAiKey = true, exchange } = options ?? {};
  const { user } = useUser();

  const aiKeyQuery = useQuery<string | null>({
    queryKey: ['ai-key', user?.id],
    enabled: !!user && includeAiKey,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/ai-key`);
        return res.data.key as string;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404)
          return null;
        throw err;
      }
    },
  });

  const sharedAiKeyQuery = useQuery<string | null>({
    queryKey: ['ai-key-shared', user?.id],
    enabled: !!user && includeAiKey,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/ai-key/shared`);
        return res.data.key as string;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404)
          return null;
        throw err;
      }
    },
  });

  const binanceKeyQuery = useQuery<ExchangeKeySummary | null>({
    queryKey: ['binance-key', user?.id],
    enabled: !!user,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/binance-key`);
        return { id: res.data.id as string } satisfies ExchangeKeySummary;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404)
          return null;
        throw err;
      }
    },
  });

  const bybitKeyQuery = useQuery<ExchangeKeySummary | null>({
    queryKey: ['bybit-key', user?.id],
    enabled: !!user,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/bybit-key`);
        return { id: res.data.id as string } satisfies ExchangeKeySummary;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404)
          return null;
        throw err;
      }
    },
  });

  const hasOpenAIKey = includeAiKey
    ? !!aiKeyQuery.data || !!sharedAiKeyQuery.data
    : false;
  const hasBinanceKey = !!binanceKeyQuery.data;
  const hasBybitKey = !!bybitKeyQuery.data;
  const binanceKeyId = binanceKeyQuery.data?.id ?? null;
  const bybitKeyId = bybitKeyQuery.data?.id ?? null;

  const modelsQuery = useQuery<string[]>({
    queryKey: ['openai-models', user?.id],
    enabled: !!user && includeAiKey && hasOpenAIKey,
    queryFn: async () => {
      const res = await api.get(`/users/${user!.id}/models`);
      return res.data.models as string[];
    },
  });

  const preferBinance = exchange === 'binance';
  const preferBybit = exchange === 'bybit';

  const accountQuery = useBinanceAccount({
    enabled: hasBinanceKey && (!preferBybit || !hasBybitKey),
  });

  const bybitAccountQuery = useBybitFuturesBalance({
    enabled:
      hasBybitKey && (preferBybit || (!preferBinance && !hasBinanceKey)),
  });

  const activeExchange =
    hasBinanceKey && (!preferBybit || !hasBybitKey)
      ? 'binance'
      : hasBybitKey && (preferBybit || (!preferBinance && !hasBinanceKey))
        ? 'bybit'
        : null;

  const accountBalances =
    activeExchange === 'binance'
      ? accountQuery.data?.balances ?? []
      : activeExchange === 'bybit'
        ? bybitAccountQuery.data?.balances ?? []
        : [];

  const earnBalanceQueries = useQueries({
    queries: tokens.map((token) => ({
      queryKey: ['binance-earn-balance', user?.id, token.toUpperCase()],
      enabled: !!user && hasBinanceKey,
      queryFn: async () => {
        try {
          const res = await api.get(
            `/users/${user!.id}/binance-earn-balance/${token.toUpperCase()}`,
          );
          return res.data as { asset: string; total: number };
        } catch (err) {
          if (axios.isAxiosError(err) && err.response?.status === 404)
            return { asset: token.toUpperCase(), total: 0 };
          throw err;
        }
      },
    })),
  });

  const priceQueries = useQueries({
    queries: tokens.map((token) => ({
      queryKey: ['token-price-usd', token.toUpperCase()],
      enabled: !!user && (hasBinanceKey || hasBybitKey),
      queryFn: async () => {
        if (['USDT', 'USDC'].includes(token.toUpperCase())) return 1;
        const res = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${token.toUpperCase()}USDT`,
        );
        if (!res.ok) return 0;
        const data = (await res.json()) as { price: string };
        return Number(data.price);
      },
    })),
  });

  const balances: BalanceInfo[] = tokens.map((token, idx) => {
    const walletInfo = accountBalances.find(
      (b) => b.asset.toUpperCase() === token.toUpperCase(),
    );
    const wallet = (walletInfo?.free ?? 0) + (walletInfo?.locked ?? 0);
    const earn = earnBalanceQueries[idx]?.data?.total ?? 0;
    const price = priceQueries[idx]?.data ?? 0;
    return {
      token,
      isLoading:
        (activeExchange === 'binance' ? accountQuery.isLoading : false) ||
        (activeExchange === 'bybit' ? bybitAccountQuery.isLoading : false) ||
        (earnBalanceQueries[idx]?.isLoading ?? false) ||
        (priceQueries[idx]?.isLoading ?? false),
      walletBalance: wallet,
      earnBalance: earn,
      usdValue: (wallet + earn) * price,
    };
  });

  return {
    hasOpenAIKey,
    hasBinanceKey,
    hasBybitKey,
    binanceKeyId,
    bybitKeyId,
    models: includeAiKey ? (modelsQuery.data ?? []) : [],
    balances,
    accountBalances,
    isAccountLoading:
      activeExchange === 'binance'
        ? accountQuery.isLoading
        : activeExchange === 'bybit'
          ? bybitAccountQuery.isLoading
          : false,
    activeExchange,
  } as const;
}
