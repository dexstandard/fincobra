import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import api from './axios';
import { parseBalanceAmount } from './parseBalanceAmount';
import { useUser } from './useUser';
import type { ExchangeAccountBalance } from './exchange-accounts.types';

export interface BybitFuturesBalance {
  balances: ExchangeAccountBalance[];
}

interface BybitFuturesBalanceResponse {
  balance?: {
    coin?: {
      coin?: string;
      walletBalance?: unknown;
      equity?: unknown;
      availableToTrade?: unknown;
      availableToWithdraw?: unknown;
      availableToTransfer?: unknown;
    }[];
  };
}

interface UseBybitFuturesBalanceOptions {
  enabled?: boolean;
}

export function useBybitFuturesBalance(
  options?: UseBybitFuturesBalanceOptions,
) {
  const { enabled = true } = options ?? {};
  const { user } = useUser();
  return useQuery<BybitFuturesBalance>({
    queryKey: ['bybit-futures-balance', user?.id],
    enabled: !!user && enabled,
    queryFn: async () => {
      try {
        const res = await api.get(
          `/users/${user!.id}/bybit/futures/balance`,
        );
        const data = res.data as BybitFuturesBalanceResponse;
        const balances = (data.balance?.coin ?? [])
          .map((entry) => {
            const asset = entry.coin?.toUpperCase();
            if (!asset) return null;
            const wallet = parseBalanceAmount(
              entry.walletBalance ?? entry.equity ?? 0,
            );
            const available = parseBalanceAmount(
              entry.availableToTrade ??
                entry.availableToWithdraw ??
                entry.availableToTransfer ??
                entry.walletBalance ??
                entry.equity ??
                0,
            );
            const locked = Math.max(wallet - available, 0);
            return {
              asset,
              free: available,
              locked,
            } satisfies ExchangeAccountBalance;
          })
          .filter((entry): entry is ExchangeAccountBalance => entry !== null);
        return { balances } satisfies BybitFuturesBalance;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          return { balances: [] } satisfies BybitFuturesBalance;
        }
        throw err;
      }
    },
  });
}
