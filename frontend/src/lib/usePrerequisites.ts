import axios from 'axios';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from './axios';
import { useUser } from './useUser';
import { useBinanceAccount } from './useBinanceAccount';
import { useBinanceFuturesBalance } from './useBinanceFuturesBalance';
import { useBybitFuturesBalance } from './useBybitFuturesBalance';
import type { ExchangeAccountBalance } from './exchange-accounts.types';
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

  const groqKeyQuery = useQuery<string | null>({
    queryKey: ['groq-key', user?.id],
    enabled: !!user && includeAiKey,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/groq-key`);
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
  const hasGroqKey = includeAiKey ? !!groqKeyQuery.data : false;
  const hasBinanceKey = !!binanceKeyQuery.data;
  const hasBybitKey = !!bybitKeyQuery.data;
  const binanceKeyId = binanceKeyQuery.data?.id ?? null;
  const bybitKeyId = bybitKeyQuery.data?.id ?? null;

  const modelsQuery = useQuery<string[]>({
    queryKey: ['ai-models', user?.id, aiProvider],
    enabled:
      !!user &&
      includeAiKey &&
      (aiProvider === 'openai' ? hasOpenAIKey : hasGroqKey),
    queryFn: async () => {
      const res = await api.get(`/users/${user!.id}/models`, {
        params: { provider: aiProvider },
      });
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
  const isFuturesMode = mode === 'futures';

  const shouldLoadBinanceFuturesAccount =
    hasBinanceKey &&
    isFuturesMode &&
    (preferBinance || !hasBybitKey);

  const shouldLoadBinanceSpotAccount =
    hasBinanceKey &&
    !isFuturesMode &&
    (!preferBybit || !hasBybitKey);

  const shouldLoadBybitAccount =
    hasBybitKey && (preferBybit || (!preferBinance && !hasBinanceKey));

  const binanceSpotAccountQuery = useBinanceAccount({
    enabled: shouldLoadBinanceSpotAccount,
  });

  const binanceFuturesAccountQuery = useBinanceFuturesBalance({
    enabled: shouldLoadBinanceFuturesAccount,
  });

  const bybitAccountQuery = useBybitFuturesBalance({
    enabled: shouldLoadBybitAccount,
  });

  let activeExchange: 'binance' | 'bybit' | null = null;
  let activeTradingMode: TradingMode | null = null;
  let accountBalances = [] as ExchangeAccountBalance[];
  let isAccountLoading = false;

  if (shouldLoadBinanceFuturesAccount) {
    activeExchange = 'binance';
    activeTradingMode = 'futures';
    accountBalances = binanceFuturesAccountQuery.data?.balances ?? [];
    isAccountLoading = binanceFuturesAccountQuery.isLoading;
  } else if (shouldLoadBinanceSpotAccount) {
    activeExchange = 'binance';
    activeTradingMode = 'spot';
    accountBalances = binanceSpotAccountQuery.data?.balances ?? [];
    isAccountLoading = binanceSpotAccountQuery.isLoading;
  } else if (shouldLoadBybitAccount) {
    activeExchange = 'bybit';
    activeTradingMode = 'futures';
    accountBalances = bybitAccountQuery.data?.balances ?? [];
    isAccountLoading = bybitAccountQuery.isLoading;
  }

  const earnBalanceQueries = useQueries({
    queries: tokens.map((token) => ({
      queryKey: ['binance-earn-balance', user?.id, token.toUpperCase()],
      enabled: !!user && shouldLoadBinanceSpotAccount,
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
        isAccountLoading ||
        (earnBalanceQueries[idx]?.isLoading ?? false) ||
        (priceQueries[idx]?.isLoading ?? false),
      walletBalance: wallet,
      earnBalance: earn,
      usdValue: (wallet + earn) * price,
    };
  });

  return {
    hasOpenAIKey,
    hasGroqKey,
    hasBinanceKey,
    hasBybitKey,
    binanceKeyId,
    bybitKeyId,
    models: includeAiKey ? (modelsQuery.data ?? []) : [],
    balances,
    accountBalances,
    isAccountLoading,
    activeExchange,
    activeTradingMode,
  } as const;
}
