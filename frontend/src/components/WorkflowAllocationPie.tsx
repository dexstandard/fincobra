import TokenDisplay from './TokenDisplay';

interface AllocationToken {
  token: string;
  minAllocation: number;
}

interface Props {
  cashToken: string;
  tokens: AllocationToken[];
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

export default function WorkflowAllocationPie({ cashToken, tokens }: Props) {
  const sortedTokens = tokens
    .map((token, index) => ({
      token: token.token.toUpperCase(),
      minAllocation: token.minAllocation,
      order: index,
    }))
    .filter((token) => token.minAllocation > 0)
    .sort((a, b) => a.order - b.order);

  const totalMin = sortedTokens.reduce((sum, token) => sum + token.minAllocation, 0);
  const remaining = Math.max(0, 100 - totalMin);

  const slices: Slice[] = [];
  let fallbackIndex = 0;

  if (remaining > 0) {
    slices.push({
      token: cashToken.toUpperCase(),
      allocation: remaining,
      color: getColor(cashToken, fallbackIndex++),
    });
  }

  sortedTokens.forEach((token) => {
    slices.push({
      token: token.token,
      allocation: token.minAllocation,
      color: getColor(token.token, fallbackIndex++),
    });
  });

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
          const formatted = percentage >= 10 ? Math.round(percentage) : percentage.toFixed(1);
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
