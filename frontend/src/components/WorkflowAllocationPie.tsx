import { useMemo } from 'react';
import TokenDisplay from './TokenDisplay';
import { useWorkflowTokenBalances } from '../lib/useWorkflowTokenBalances';

interface AllocationToken {
  token: string;
  minAllocation: number;
}

interface Props {
  cashToken: string;
  tokens: AllocationToken[];
  ownerId: string;
}

const TOKEN_COLORS: Record<string, string> = {
  BTC: '#f59e0b',
  BNB: '#facc15',
  DOGE: '#fde047',
  ETH: '#6366f1',
  HBAR: '#14b8a6',
  PEPE: '#84cc16',
  SHIB: '#ef4444',
  SOL: '#0ea5e9',
  TON: '#38bdf8',
  TRX: '#ef4444',
  USDT: '#10b981',
  USDC: '#3b82f6',
  XRP: '#8b5cf6',
};

const FALLBACK_COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#f43f5e'];

interface Slice {
  token: string;
  allocation: number;
  color: string;
}

function getColor(symbol: string, index: number) {
  const key = symbol.toUpperCase();
  return TOKEN_COLORS[key] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
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

  const actualSlices: Slice[] = useMemo(() => {
    if (!enabled || isLoading || !balances?.length) return [];
    const aggregated = new Map<string, number>();
    balances.forEach((balance) => {
      if (balance.usdValue <= 0) return;
      const key = balance.token.toUpperCase();
      aggregated.set(key, (aggregated.get(key) ?? 0) + balance.usdValue);
    });
    const entries = Array.from(aggregated.entries());
    if (!entries.length) return [];
    return entries.map(([token, allocation], index) => ({
      token,
      allocation,
      color: getColor(token, index),
    }));
  }, [balances, enabled, isLoading]);

  const fallbackSlices: Slice[] = useMemo(() => {
    const orderedTokens = tokens
      .map((token, index) => ({
        token: token.token.toUpperCase(),
        minAllocation: token.minAllocation,
        order: index,
      }))
      .filter((token) => token.minAllocation > 0)
      .sort((a, b) => a.order - b.order);

    const totalMin = orderedTokens.reduce(
      (sum, token) => sum + token.minAllocation,
      0,
    );
    const remaining = Math.max(0, 100 - totalMin);

    const allocations = new Map<string, number>();
    const addSlice = (token: string, allocation: number) => {
      if (allocation <= 0) return;
      const upper = token.toUpperCase();
      allocations.set(upper, (allocations.get(upper) ?? 0) + allocation);
    };

    addSlice(cashToken, remaining);
    orderedTokens.forEach((token) => addSlice(token.token, token.minAllocation));

    const entries = Array.from(allocations.entries());
    return entries.map(([token, allocation], index) => ({
      token,
      allocation,
      color: getColor(token, index),
    }));
  }, [cashToken, tokens]);

  const slices = actualSlices.length > 0 ? actualSlices : fallbackSlices;
  const totalAllocation = slices.reduce((sum, slice) => sum + slice.allocation, 0);

  if (!totalAllocation) {
    return null;
  }

  let currentAngle = 0;
  const gradientStops = slices
    .map((slice) => {
      const slicePercentage = (slice.allocation / totalAllocation) * 100;
      const start = currentAngle;
      const end = currentAngle + slicePercentage;
      currentAngle = end;
      return `${slice.color} ${start}% ${end}%`;
    })
    .join(', ');

  return (
    <div className="mt-3 flex items-center gap-3 text-xs text-gray-600">
      <div
        className="h-14 w-14 rounded-full border border-gray-200"
        style={{ background: `conic-gradient(${gradientStops})` }}
        aria-label="Workflow allocation chart"
      />
      <div className="flex flex-col gap-1">
        {slices.map((slice) => {
          const percentage = (slice.allocation / totalAllocation) * 100;
          const formatted =
            percentage >= 10 ? Math.round(percentage) : percentage.toFixed(1);
          return (
            <div key={slice.token} className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <TokenDisplay token={slice.token} className="text-xs" />
              <span>{formatted}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
