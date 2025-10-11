import { useMemo } from 'react';
import type { BalanceInfo } from '../../lib/usePrerequisites';
import TokenAllocationChart from '../TokenAllocationChart';
import type {
  AllocationSlice,
  AllocationToken,
} from '../tokenAllocation.types';
import { buildFallbackSlices } from '../tokenAllocation.utils';

interface Props {
  cashToken: string | undefined;
  tokens: AllocationToken[];
  balances: BalanceInfo[];
  useEarn: boolean;
}

function calculateUsdValue(balance: BalanceInfo, useEarn: boolean) {
  const totalHoldings = balance.walletBalance + balance.earnBalance;
  const price = totalHoldings > 0 ? balance.usdValue / totalHoldings : 0;
  const effectiveHoldings =
    balance.walletBalance + (useEarn ? balance.earnBalance : 0);
  return effectiveHoldings * price;
}

export default function PortfolioAllocationPreview({
  cashToken,
  tokens,
  balances,
  useEarn,
}: Props) {
  const actualSlices = useMemo<AllocationSlice[]>(() => {
    if (!cashToken) return [];
    const aggregated = new Map<string, number>();
    balances.forEach((balance) => {
      const allocation = calculateUsdValue(balance, useEarn);
      if (allocation <= 0) return;
      const token = balance.token.toUpperCase();
      aggregated.set(token, (aggregated.get(token) ?? 0) + allocation);
    });

    return Array.from(aggregated.entries()).map(([token, allocation]) => ({
      token,
      allocation,
    }));
  }, [balances, useEarn, cashToken]);

  const fallbackSlices = useMemo(
    () => buildFallbackSlices(cashToken, tokens),
    [cashToken, tokens],
  );

  const slices = actualSlices.length > 0 ? actualSlices : fallbackSlices;
  return (
    <TokenAllocationChart
      slices={slices}
      ariaLabel="Portfolio allocation chart"
    />
  );
}
