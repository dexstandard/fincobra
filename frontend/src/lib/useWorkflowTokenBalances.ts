import axios from 'axios';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from './axios';
import { parseBalanceAmount } from './parseBalanceAmount';
import { useUser } from './useUser';

interface BinanceBalanceResponse {
  free?: unknown;
  locked?: unknown;
}

export interface WorkflowTokenBalance {
  token: string;
  amount: number;
  usdValue: number;
}

interface TokenBalanceQueryResult {
  token: string;
  amount: number;
  usdValue: number;
}

export function useWorkflowTokenBalances(tokens: string[], ownerId?: string) {
  const { user } = useUser();
  const normalizedTokens = useMemo(
    () =>
      tokens
        .map((token) => token?.toUpperCase())
        .filter((token): token is string => !!token && token.trim().length > 0),
    [tokens],
  );
  const uniqTokens = useMemo(
    () => Array.from(new Set(normalizedTokens)),
    [normalizedTokens],
  );

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
          queryKey: ['workflow-token-balance', targetUserId, token],
          enabled,
          queryFn: async (): Promise<TokenBalanceQueryResult> => {
            const tokenUpper = token.toUpperCase();
            try {
              const res = await api.get(
                `/users/${targetUserId}/binance/balance/${tokenUpper}`,
              );
              const balance = res.data as BinanceBalanceResponse;
              const amount =
                parseBalanceAmount(balance.free) +
                parseBalanceAmount(balance.locked);
              if (!amount)
                return { token: tokenUpper, amount: 0, usdValue: 0 };
              if (['USDT', 'USDC'].includes(tokenUpper))
                return { token: tokenUpper, amount, usdValue: amount };
              const priceRes = await fetch(
                `https://api.binance.com/api/v3/ticker/price?symbol=${tokenUpper}USDT`,
              );
              if (!priceRes.ok)
                return { token: tokenUpper, amount, usdValue: 0 };
              const priceData = (await priceRes.json()) as { price: string };
              const price = Number(priceData.price);
              if (!Number.isFinite(price) || price <= 0)
                return { token: tokenUpper, amount, usdValue: 0 };
              return { token: tokenUpper, amount, usdValue: amount * price };
            } catch (err) {
              if (
                axios.isAxiosError(err) &&
                (err.response?.status === 403 || err.response?.status === 404)
              ) {
                return { token: tokenUpper, amount: 0, usdValue: 0 };
              }
              throw err;
            }
          },
        }))
      : [],
  });

  if (!enabled)
    return { balances: null, isLoading: false, enabled: false } as const;

  const isLoading = balanceQueries.some((query) => query.isLoading);
  const balances = balanceQueries
    .map((query) => query.data)
    .filter((entry): entry is TokenBalanceQueryResult => !!entry)
    .map((entry) => ({
      token: entry.token,
      amount: entry.amount,
      usdValue: entry.usdValue,
    } satisfies WorkflowTokenBalance));

  return { balances, isLoading, enabled: true } as const;
}
