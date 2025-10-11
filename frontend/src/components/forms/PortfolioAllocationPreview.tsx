import { useMemo } from 'react';
import TokenDisplay from '../TokenDisplay';
import type { BalanceInfo } from '../../lib/usePrerequisites';

interface AllocationToken {
  token: string;
  minAllocation: number;
}

interface Props {
  cashToken: string | undefined;
  tokens: AllocationToken[];
  balances: BalanceInfo[];
  useEarn: boolean;
}

interface Slice {
  token: string;
  allocation: number;
  color: string;
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

function getColor(symbol: string, index: number) {
  const key = symbol.toUpperCase();
  return TOKEN_COLORS[key] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
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
  const actualSlices = useMemo(() => {
    if (!cashToken) return [] as Slice[];

    const aggregated = new Map<string, number>();
    balances.forEach((balance) => {
      const allocation = calculateUsdValue(balance, useEarn);
      if (allocation <= 0) return;
      const token = balance.token.toUpperCase();
      aggregated.set(token, (aggregated.get(token) ?? 0) + allocation);
    });

    return Array.from(aggregated.entries()).map(([token, allocation], index) => ({
      token,
      allocation,
      color: getColor(token, index),
    }));
  }, [balances, useEarn, cashToken]);

  const fallbackSlices = useMemo(() => {
    if (!cashToken) return [] as Slice[];
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

    return Array.from(allocations.entries()).map(([token, allocation], index) => ({
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
        aria-label="Portfolio allocation chart"
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
