import { useMemo } from 'react';
import { useWorkflowTokenBalances } from '../lib/useWorkflowTokenBalances';
import TokenAllocationChart from './TokenAllocationChart';
import type { AllocationSlice, AllocationToken } from './tokenAllocation.types';
import { buildFallbackSlices } from './tokenAllocation.utils';

interface Props {
  cashToken: string;
  tokens: AllocationToken[];
  ownerId: string;
}

export default function WorkflowAllocationPie({ cashToken, tokens, ownerId }: Props) {
  const tokenSymbols = useMemo(
    () => [cashToken, ...tokens.map((token) => token.token)],
    [cashToken, tokens],
  );
  const { balances, isLoading, enabled } = useWorkflowTokenBalances(
    tokenSymbols,
    ownerId,
  );

  const actualSlices: AllocationSlice[] = useMemo(() => {
    if (!enabled || isLoading || !balances?.length) return [];
    const aggregated = new Map<string, number>();
    balances.forEach((balance) => {
      if (balance.usdValue <= 0) return;
      const key = balance.token.toUpperCase();
      aggregated.set(key, (aggregated.get(key) ?? 0) + balance.usdValue);
    });
    const entries = Array.from(aggregated.entries());
    if (!entries.length) return [];
    return entries.map(([token, allocation]) => ({
      token,
      allocation,
    }));
  }, [balances, enabled, isLoading]);

  const fallbackSlices: AllocationSlice[] = useMemo(
    () => buildFallbackSlices(cashToken, tokens),
    [cashToken, tokens],
  );

  const slices = actualSlices.length > 0 ? actualSlices : fallbackSlices;

  return (
    <TokenAllocationChart
      slices={slices}
      ariaLabel="Workflow allocation chart"
    />
  );
}
