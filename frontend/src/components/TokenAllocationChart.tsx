import { useMemo } from 'react';
import TokenDisplay from './TokenDisplay';
import type { AllocationSlice } from './tokenAllocation.types';

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

function getTokenColor(symbol: string, index: number) {
  const key = symbol.toUpperCase();
  return TOKEN_COLORS[key] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface Props {
  slices: AllocationSlice[];
  ariaLabel: string;
}

export default function TokenAllocationChart({ slices, ariaLabel }: Props) {
  const normalizedSlices = useMemo(
    () =>
      slices
        .filter((slice) => slice.allocation > 0)
        .map((slice) => ({
          token: slice.token.toUpperCase(),
          allocation: slice.allocation,
        })),
    [slices],
  );

  const totalAllocation = useMemo(
    () => normalizedSlices.reduce((sum, slice) => sum + slice.allocation, 0),
    [normalizedSlices],
  );

  const coloredSlices = useMemo(
    () =>
      normalizedSlices.map((slice, index) => ({
        ...slice,
        color: getTokenColor(slice.token, index),
      })),
    [normalizedSlices],
  );

  const gradientStops = useMemo(() => {
    if (!totalAllocation) return '';
    let currentAngle = 0;
    return coloredSlices
      .map((slice) => {
        const slicePercentage = (slice.allocation / totalAllocation) * 100;
        const start = currentAngle;
        const end = currentAngle + slicePercentage;
        currentAngle = end;
        return `${slice.color} ${start}% ${end}%`;
      })
      .join(', ');
  }, [coloredSlices, totalAllocation]);

  if (!totalAllocation) {
    return null;
  }

  return (
    <div className="mt-3 flex items-center gap-3 text-xs text-gray-600">
      <div
        className="h-14 w-14 rounded-full border border-gray-200"
        style={{ background: `conic-gradient(${gradientStops})` }}
        aria-label={ariaLabel}
      />
      <div className="flex flex-col gap-1">
        {coloredSlices.map((slice) => {
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
