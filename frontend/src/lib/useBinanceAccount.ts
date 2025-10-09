import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import api from './axios';
import { parseBalanceAmount } from './parseBalanceAmount';
import { useUser } from './useUser';
import type { ExchangeAccountBalance } from './exchange-accounts.types';

export interface BinanceAccount {
  balances: ExchangeAccountBalance[];
}

interface BinanceAccountResponse {
  balances?: { asset: string; free: unknown; locked: unknown }[];
}

interface UseBinanceAccountOptions {
  enabled?: boolean;
}

export function useBinanceAccount(options?: UseBinanceAccountOptions) {
  const { enabled = true } = options ?? {};
  const { user } = useUser();
  return useQuery<BinanceAccount>({
    queryKey: ['binance-account', user?.id],
    enabled: !!user && enabled,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/binance-account`);
        const data = res.data as BinanceAccountResponse;
        const balances = (data.balances ?? []).map((balance) => ({
          asset: balance.asset,
          free: parseBalanceAmount(balance.free),
          locked: parseBalanceAmount(balance.locked),
        }));
        return { balances } satisfies BinanceAccount;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          return { balances: [] };
        }
        throw err;
      }
    },
  });
}
