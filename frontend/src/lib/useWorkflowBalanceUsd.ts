import { useWorkflowTokenBalances } from './useWorkflowTokenBalances';

export function useWorkflowBalanceUsd(tokens: string[], ownerId?: string) {
  const { balances, isLoading, enabled } = useWorkflowTokenBalances(tokens, ownerId);

  if (!enabled)
    return { balance: null, isLoading: false } as const;

  if (!balances)
    return { balance: null, isLoading } as const;

  const total = balances.reduce((sum, entry) => sum + entry.usdValue, 0);
  return { balance: total, isLoading } as const;
}
