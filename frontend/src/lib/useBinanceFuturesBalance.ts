import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import api from './axios';
import { parseBalanceAmount } from './parseBalanceAmount';
import { useUser } from './useUser';
import type { ExchangeAccountBalance } from './exchange-accounts.types';

interface BinanceFuturesBalanceResponse {
  balances?: { asset: string; free: unknown; locked: unknown }[];
}

export interface BinanceFuturesBalance {
  balances: ExchangeAccountBalance[];
}

interface UseBinanceFuturesBalanceOptions {
  enabled?: boolean;
}

export function useBinanceFuturesBalance(
  options?: UseBinanceFuturesBalanceOptions,
) {
  const { enabled = true } = options ?? {};
  const { user } = useUser();

  return useQuery<BinanceFuturesBalance>({
    queryKey: ['binance-futures-balance', user?.id],
    enabled: !!user && enabled,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/binance/futures/balance`);
        const data = res.data as BinanceFuturesBalanceResponse;
        const balances = (data.balances ?? [])
          .map((balance) => {
            const asset = balance.asset?.toUpperCase();
            if (!asset) return null;
            return {
              asset,
              free: parseBalanceAmount(balance.free),
              locked: parseBalanceAmount(balance.locked),
            } satisfies ExchangeAccountBalance;
          })
          .filter(
            (entry): entry is ExchangeAccountBalance => entry !== null,
          );
        return { balances } satisfies BinanceFuturesBalance;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          return { balances: [] } satisfies BinanceFuturesBalance;
        }
        throw err;
      }
    },
  });
}
