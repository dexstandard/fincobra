import axios from 'axios';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from './axios';
import { useUser } from './useUser';

export function useAgentBalanceUsd(tokens: string[]) {
  const { user } = useUser();
  const uniqTokens = Array.from(
    new Set(tokens.map((t) => t.toUpperCase())),
  );
  const { data: binanceKey } = useQuery<string | null>({
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

  const enabled = !!user && !!binanceKey && uniqTokens.length > 0;
  const balanceQueries = useQueries({
    queries: enabled
      ? uniqTokens.map((token) => ({
          queryKey: ['binance-balance-usd', user?.id, token.toUpperCase()],
          enabled,
          queryFn: async () => {
            const res = await api.get(
              `/users/${user!.id}/binance-balance/${token.toUpperCase()}`
            );
            const bal = res.data as { free: number; locked: number };
            const amount = (bal.free ?? 0) + (bal.locked ?? 0);
            if (!amount) return 0;
            if (['USDT', 'USDC'].includes(token.toUpperCase())) return amount;
            const priceRes = await fetch(
              `https://api.binance.com/api/v3/ticker/price?symbol=${token.toUpperCase()}USDT`
            );
            if (!priceRes.ok) return 0;
            const priceData = (await priceRes.json()) as { price: string };
            return amount * Number(priceData.price);
          },
        }))
      : [],
  });

  if (!enabled) return { balance: null, isLoading: false } as const;
  const isLoading = balanceQueries.some((q) => q.isLoading);
  const total = balanceQueries.reduce((sum, q) => sum + (q.data ?? 0), 0);
  return { balance: total, isLoading } as const;
}
