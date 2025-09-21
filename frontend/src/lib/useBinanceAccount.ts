import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import api from './axios';
import { parseBalanceAmount } from './parseBalanceAmount';
import { useUser } from './useUser';

export interface BinanceAccount {
  balances: { asset: string; free: number; locked: number }[];
}

interface BinanceAccountResponse {
  balances?: { asset: string; free: unknown; locked: unknown }[];
}

export function useBinanceAccount() {
  const { user } = useUser();
  return useQuery<BinanceAccount>({
    queryKey: ['binance-account', user?.id],
    enabled: !!user,
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
