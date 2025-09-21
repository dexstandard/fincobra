import axios from 'axios';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from './axios';
import { useUser } from './useUser';
import { useBinanceAccount } from './useBinanceAccount';

export interface BalanceInfo {
  token: string;
  isLoading: boolean;
  walletBalance: number;
  earnBalance: number;
  usdValue: number;
}

export function usePrerequisites(
  tokens: string[],
  options?: { includeAiKey?: boolean },
) {
  const { includeAiKey = true } = options ?? {};
  const { user } = useUser();

  const aiKeyQuery = useQuery<string | null>({
    queryKey: ['ai-key', user?.id],
    enabled: !!user && includeAiKey,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/ai-key`);
        return res.data.key as string;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) return null;
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
        if (axios.isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }
    },
  });

  const binanceKeyQuery = useQuery<string | null>({
    queryKey: ['binance-key', user?.id],
    enabled: !!user,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/binance-key`);
        return res.data.key as string;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) return null;
        throw err;
      }
    },
  });

  const hasOpenAIKey = includeAiKey
    ? !!aiKeyQuery.data || !!sharedAiKeyQuery.data
    : false;
  const hasBinanceKey = !!binanceKeyQuery.data;

  const modelsQuery = useQuery<string[]>({
    queryKey: ['openai-models', user?.id],
    enabled: !!user && includeAiKey && hasOpenAIKey,
    queryFn: async () => {
      const res = await api.get(`/users/${user!.id}/models`);
      return res.data.models as string[];
    },
  });

  const accountQuery = useBinanceAccount();
  const accountBalances = accountQuery.data?.balances ?? [];

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
      queryKey: ['binance-price', token.toUpperCase()],
      enabled: !!user && hasBinanceKey,
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
    const wallet =
      (walletInfo?.free ?? 0) +
      (walletInfo?.locked ?? 0);
    const earn = earnBalanceQueries[idx]?.data?.total ?? 0;
    const price = priceQueries[idx]?.data ?? 0;
    return {
      token,
      isLoading:
        accountQuery.isLoading ||
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
    models: includeAiKey ? modelsQuery.data ?? [] : [],
    balances,
    accountBalances,
    isAccountLoading: accountQuery.isLoading,
  } as const;
}

