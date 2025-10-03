import axios from 'axios';
import { useQueries, useQuery } from '@tanstack/react-query';
import api from './axios';
import { parseBalanceAmount } from './parseBalanceAmount';
import { useUser } from './useUser';

interface BinanceBalanceResponse {
  free?: unknown;
  locked?: unknown;
}

export function useWorkflowBalanceUsd(tokens: string[], ownerId?: string) {
  const { user } = useUser();
  const uniqTokens = Array.from(new Set(tokens.map((t) => t.toUpperCase())));
  const targetUserId = ownerId ?? user?.id;
  const isAdmin = user?.role === 'admin';
  const isOwner = !!targetUserId && targetUserId === user?.id;
  const canAccess = !!user && !!targetUserId && (isOwner || isAdmin);

  const { data: binanceKey } = useQuery<string | null>({
    queryKey: ['binance-key', targetUserId],
    enabled: canAccess && isOwner,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${targetUserId}/binance-key`);
        return res.data.key as string;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404)
          return null;
        throw err;
      }
    },
  });

  const hasKey = isOwner ? !!binanceKey : true;
  const enabled = canAccess && hasKey && uniqTokens.length > 0;
  const balanceQueries = useQueries({
    queries: enabled
      ? uniqTokens.map((token) => ({
          queryKey: ['binance-balance-usd', targetUserId, token.toUpperCase()],
          enabled,
          queryFn: async () => {
            const tokenUpper = token.toUpperCase();
            try {
              const res = await api.get(
                `/users/${targetUserId}/binance-balance/${tokenUpper}`,
              );
              const bal = res.data as BinanceBalanceResponse;
              const amount =
                parseBalanceAmount(bal.free) + parseBalanceAmount(bal.locked);
              if (!amount) return 0;
              if (['USDT', 'USDC'].includes(tokenUpper)) return amount;
              const priceRes = await fetch(
                `https://api.binance.com/api/v3/ticker/price?symbol=${tokenUpper}USDT`,
              );
              if (!priceRes.ok) return 0;
              const priceData = (await priceRes.json()) as { price: string };
              return amount * Number(priceData.price);
            } catch (err) {
              if (
                axios.isAxiosError(err) &&
                (err.response?.status === 403 || err.response?.status === 404)
              ) {
                return 0;
              }
              throw err;
            }
          },
        }))
      : [],
  });

  if (!enabled) return { balance: null, isLoading: false } as const;
  const isLoading = balanceQueries.some((q) => q.isLoading);
  const total = balanceQueries.reduce((sum, q) => sum + (q.data ?? 0), 0);
  return { balance: total, isLoading } as const;
}
