import axios from 'axios';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from './axios';
import { useUser } from './useUser';
import { useBinanceAccount } from './useBinanceAccount';
import { useBybitFuturesBalance } from './useBybitFuturesBalance';
import type { TradingMode } from './exchange.types';

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
  mode?: TradingMode;
  aiProvider?: 'openai' | 'groq';
}

interface ExchangeKeySummary {
  id: string;
}

export function usePrerequisites(
  tokens: string[],
  options?: UsePrerequisitesOptions,
) {
  const {
    includeAiKey = true,
    exchange,
    mode,
    aiProvider = 'openai',
  } = options ?? {};
  const { user } = useUser();

  const aiKeyQuery = useQuery<string | null>({
    queryKey: [aiProvider === 'groq' ? 'groq-key' : 'ai-key', user?.id],
    enabled: !!user && includeAiKey,
    queryFn: async () => {
      try {
        const path =
          aiProvider === 'groq'
            ? `/users/${user!.id}/groq-key`
            : `/users/${user!.id}/ai-key`;
        const res = await api.get(path);
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
    enabled: !!user && includeAiKey && aiProvider === 'openai',
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

  const hasAiKey = includeAiKey
    ? aiProvider === 'openai'
      ? !!aiKeyQuery.data || !!sharedAiKeyQuery.data
      : !!aiKeyQuery.data
    : false;
  const hasBinanceKey = !!binanceKeyQuery.data;
  const hasBybitKey = !!bybitKeyQuery.data;
  const binanceKeyId = binanceKeyQuery.data?.id ?? null;
  const bybitKeyId = bybitKeyQuery.data?.id ?? null;

  const modelsQuery = useQuery<string[]>({
    queryKey: ['ai-models', aiProvider, user?.id],
    enabled: !!user && includeAiKey && hasAiKey,
    queryFn: async () => {
      const res = await api.get(
        `/users/${user!.id}/models?provider=${aiProvider}`,
      );
      return res.data.models as string[];
    },
  });

  const preferredExchange =
    exchange ??
    (mode === 'futures'
      ? 'bybit'
      : mode === 'spot'
        ? 'binance'
        : undefined);
  const preferBinance = preferredExchange === 'binance';
  const preferBybit = preferredExchange === 'bybit';

  const shouldLoadBinanceAccount =
    hasBinanceKey && (!preferBybit || !hasBybitKey);
  const shouldLoadBybitAccount =
    hasBybitKey && (preferBybit || (!preferBinance && !hasBinanceKey));

  const accountQuery = useBinanceAccount({
    enabled: shouldLoadBinanceAccount,
  });

  const bybitAccountQuery = useBybitFuturesBalance({
    enabled: shouldLoadBybitAccount,
  });

  const activeExchange = shouldLoadBinanceAccount
    ? 'binance'
    : shouldLoadBybitAccount
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
      enabled: !!user && shouldLoadBinanceAccount,
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
        (shouldLoadBinanceAccount ? accountQuery.isLoading : false) ||
        (shouldLoadBybitAccount ? bybitAccountQuery.isLoading : false) ||
        (earnBalanceQueries[idx]?.isLoading ?? false) ||
        (priceQueries[idx]?.isLoading ?? false),
      walletBalance: wallet,
      earnBalance: earn,
      usdValue: (wallet + earn) * price,
    };
  });

  const activeTradingMode: TradingMode | null =
    activeExchange === 'bybit'
      ? 'futures'
      : activeExchange === 'binance'
        ? 'spot'
        : null;

  return {
    hasAiKey,
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
    activeTradingMode,
  } as const;
}
