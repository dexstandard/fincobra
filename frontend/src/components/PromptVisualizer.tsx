import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  Clock,
  FileText,
  Gauge,
  Layers3,
  Newspaper,
  PieChart,
  Route,
  ShieldCheck,
} from 'lucide-react';
import FormattedDate from './ui/FormattedDate';
import {
  type PromptData,
  type PromptMarketOverview,
  type PromptPosition,
  type PromptReport,
  type PromptRoute,
  type PromptRouteAsset,
  type PromptPreviousReport,
  type PromptRiskFlags,
  type PromptFearGreedIndex,
} from './PromptVisualizer.types';

interface Props {
  data: PromptData;
  raw?: string | null;
}

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFormatterPrecise = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

const numberFormatter0 = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const numberFormatter2 = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const numberFormatter4 = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 4,
});

const numberFormatter6 = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 6,
});

const numberFormatter8 = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 8,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const palette = ['#7c3aed', '#f97316', '#0ea5e9', '#22c55e', '#facc15', '#14b8a6'];

function formatIsoDuration(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const weekMatch = /^P(?:(\d+(?:\.\d+)?)W)$/.exec(trimmed);
  if (weekMatch) {
    const weeks = Number(weekMatch[1]);
    if (Number.isFinite(weeks)) {
      const formatted = numberFormatter2.format(weeks);
      return `${formatted} ${Math.abs(weeks) === 1 ? 'week' : 'weeks'}`;
    }
    return null;
  }

  const isoMatch =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      trimmed,
    );
  if (!isoMatch) return null;
  const [, days, hours, minutes, seconds] = isoMatch;

  const parts: string[] = [];

  const appendPart = (amount: string | undefined, unit: string) => {
    if (!amount) return;
    const valueNumber = Number(amount);
    if (!Number.isFinite(valueNumber)) return;
    const formatted = numberFormatter2.format(valueNumber);
    const label = Math.abs(valueNumber) === 1 ? unit : `${unit}s`;
    parts.push(`${formatted} ${label}`);
  };

  appendPart(days, 'day');
  appendPart(hours, 'hour');
  appendPart(minutes, 'minute');
  appendPart(seconds, 'second');

  if (parts.length === 0) return null;
  return parts.join(', ');
}

function formatDecimalPercent(value?: number): string {
  if (typeof value !== 'number') return '—';
  return `${percentFormatter.format(value * 100)}%`;
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number') return '—';
  return `${percentFormatter.format(value)}%`;
}

function formatNumber(value?: number): string {
  if (typeof value !== 'number') return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1000) return numberFormatter0.format(value);
  if (abs >= 1) return numberFormatter2.format(value);
  if (abs >= 0.1) return numberFormatter4.format(value);
  if (abs >= 0.01) return numberFormatter6.format(value);
  return numberFormatter8.format(value);
}

function formatCurrency(value?: number): string {
  if (typeof value !== 'number') return '—';
  return Math.abs(value) >= 0.01
    ? currencyFormatter.format(value)
    : currencyFormatterPrecise.format(value);
}

function getRiskFlags(flags?: PromptRiskFlags): string[] {
  if (!flags) return [];
  return Object.entries(flags)
    .filter(([, value]) => value)
    .map(([key]) => key);
}

function FearGreedSection({
  fearGreedIndex,
}: {
  fearGreedIndex: PromptFearGreedIndex;
}) {
  const rawValue =
    typeof fearGreedIndex.value === 'number' && Number.isFinite(fearGreedIndex.value)
      ? fearGreedIndex.value
      : null;
  const clampedValue = rawValue === null ? null : Math.min(100, Math.max(0, rawValue));
  const classification = fearGreedIndex.classification?.trim();
  const hasValue = clampedValue !== null;
  const hasClassification = Boolean(classification);

  if (!hasValue && !hasClassification) {
    return null;
  }

  return (
    <div className="rounded border border-gray-200 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
        <Gauge className="h-4 w-4 text-emerald-500" />
        Fear &amp; Greed Index
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {hasValue && (
          <div>
            <div className="text-3xl font-bold text-gray-800">
              {numberFormatter0.format(clampedValue ?? 0)}
            </div>
            <div className="text-xs text-gray-500">Score (0-100)</div>
          </div>
        )}
        {hasClassification && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
            {classification}
          </span>
        )}
      </div>
      {hasValue && (
        <div className="mt-4 w-full">
          <div className="relative h-2 rounded-full bg-gray-200" aria-hidden>
            <div
              className="absolute left-0 top-0 h-2 rounded-full bg-emerald-500"
              style={{ width: `${clampedValue}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-gray-400">
            <span>Fear</span>
            <span>Greed</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PortfolioPieChart({ positions }: { positions: PromptPosition[] }) {
  const segments = useMemo(() => {
    const total = positions.reduce((sum, position) => sum + (position.valueUsdt ?? 0), 0);
    if (!total) {
      return [];
    }
    let current = 0;
    return positions.map((position, index) => {
      const value = position.valueUsdt ?? 0;
      const percent = value / total;
      const start = current * 100;
      const end = (current + percent) * 100;
      current += percent;
      return {
        sym: position.sym,
        value,
        percent,
        color: palette[index % palette.length],
        stop: `${palette[index % palette.length]} ${start}% ${end}%`,
      };
    });
  }, [positions]);

  const gradient = segments.length
    ? `conic-gradient(${segments.map((segment) => segment.stop).join(', ')})`
    : 'conic-gradient(#e5e7eb 0% 100%)';
  const totalValue = positions.reduce(
    (sum, position) => sum + (position.valueUsdt ?? 0),
    0,
  );

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className="h-32 w-32 rounded-full border border-gray-200"
        style={{ background: gradient }}
        aria-hidden
      />
      <div className="space-y-2">
        {positions.map((position, index) => {
          const value = position.valueUsdt ?? 0;
          const percent = totalValue ? (value / totalValue) * 100 : 0;
          return (
            <div key={position.sym} className="flex items-center gap-2 text-sm">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: palette[index % palette.length] }}
              />
              <span className="font-medium">{position.sym}</span>
              <span className="text-gray-500">
                {formatCurrency(value)} · {percentFormatter.format(percent)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarketOverviewSection({
  marketOverview,
}: {
  marketOverview: PromptMarketOverview;
}) {
  const assets = Object.entries(marketOverview.marketOverview ?? {});
  if (assets.length === 0) return null;
  const decisionInterval = marketOverview.timeframe?.decisionInterval;
  const friendlyDecisionInterval = formatIsoDuration(decisionInterval);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
        <BarChart3 className="h-4 w-4" />
        <span>
          As of{' '}
          {marketOverview.asOf ? (
            <FormattedDate date={marketOverview.asOf} />
          ) : (
            'latest snapshot'
          )}
        </span>
        {marketOverview.timeframe?.candleInterval && (
          <span>
            · {marketOverview.timeframe.candleInterval} candles /
            {` ${friendlyDecisionInterval ?? marketOverview.timeframe.decisionInterval ?? 'interval'}`}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {assets.map(([asset, info]) => {
          const riskFlags = getRiskFlags(info.riskFlags);
          const ltf = info.ltf;
          const ltfMetrics: { label: string; value: string }[] = [];
          if (typeof ltf?.alignmentScore === 'number') {
            ltfMetrics.push({ label: 'Alignment', value: formatNumber(ltf.alignmentScore) });
          }
          if (typeof ltf?.ret10m === 'number') {
            ltfMetrics.push({ label: 'Return (10m)', value: formatDecimalPercent(ltf.ret10m) });
          }
          if (typeof ltf?.ret30m === 'number') {
            ltfMetrics.push({ label: 'Return (30m)', value: formatDecimalPercent(ltf.ret30m) });
          }
          if (typeof ltf?.rsi10m === 'number') {
            ltfMetrics.push({ label: 'RSI (10m)', value: formatNumber(ltf.rsi10m) });
          }
          if (typeof ltf?.rsi30m === 'number') {
            ltfMetrics.push({ label: 'RSI (30m)', value: formatNumber(ltf.rsi30m) });
          }
          if (typeof ltf?.slope10m === 'string') {
            ltfMetrics.push({ label: 'Slope (10m)', value: ltf.slope10m });
          }
          if (typeof ltf?.slope30m === 'string') {
            ltfMetrics.push({ label: 'Slope (30m)', value: ltf.slope30m });
          }
          const hasLtfContent =
            (ltf?.frames && ltf.frames.length > 0) || typeof ltf?.alignmentScore === 'number' || ltfMetrics.length > 0;
          return (
            <div key={asset} className="rounded border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-500" />
                  {asset}
                </h3>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                  Trend: {info.trendSlope ?? 'unknown'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-gray-500">1h Return</p>
                  <p className="font-semibold">{formatDecimalPercent(info.ret1h)}</p>
                </div>
                <div>
                  <p className="text-gray-500">24h Return</p>
                  <p className="font-semibold">{formatDecimalPercent(info.ret24h)}</p>
                </div>
                <div>
                  <p className="text-gray-500">RSI (1h)</p>
                  <p className="font-semibold">{formatNumber(info.rsi14)}</p>
                </div>
                <div>
                  <p className="text-gray-500">ATR Vol</p>
                  <p className="font-semibold">{formatPercent(info.volAtrPct)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Vol Z-score</p>
                  <p className="font-semibold">{formatNumber(info.volAnomalyZ)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Spread (bps)</p>
                  <p className="font-semibold">{formatNumber(info.orderbookSpreadBps)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Depth Ratio</p>
                  <p className="font-semibold">{formatNumber(info.orderbookDepthRatio)}</p>
                </div>
                <div>
                  <p className="text-gray-500">HTF Regime</p>
                  <p className="font-semibold">{info.htf?.regime?.volState ?? '—'}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <div className="rounded bg-purple-100 px-2 py-0.5 text-purple-700">
                  4h: {info.htf?.trend?.['4h']?.slope ?? '—'} ({formatPercent(
                    info.htf?.trend?.['4h']?.gapPct,
                  )})
                </div>
                <div className="rounded bg-purple-100 px-2 py-0.5 text-purple-700">
                  1d: {info.htf?.trend?.['1d']?.slope ?? '—'} ({formatPercent(
                    info.htf?.trend?.['1d']?.gapPct,
                  )})
                </div>
                <div className="rounded bg-purple-100 px-2 py-0.5 text-purple-700">
                  1w: {info.htf?.trend?.['1w']?.slope ?? '—'} ({formatPercent(
                    info.htf?.trend?.['1w']?.gapPct,
                  )})
                </div>
                {typeof info.htf?.regime?.volRank1y === 'number' && (
                  <div className="rounded bg-sky-100 px-2 py-0.5 text-sky-700">
                    Vol Rank 1y: {percentFormatter.format(info.htf.regime.volRank1y * 100)}%
                  </div>
                )}
                {typeof info.htf?.regime?.corrBtc90d === 'number' && (
                  <div className="rounded bg-sky-100 px-2 py-0.5 text-sky-700">
                    Corr BTC 90d: {formatNumber(info.htf.regime.corrBtc90d)}
                  </div>
                )}
                {typeof info.htf?.regime?.marketBeta90d === 'number' && (
                  <div className="rounded bg-sky-100 px-2 py-0.5 text-sky-700">
                    Beta 90d: {formatNumber(info.htf.regime.marketBeta90d)}
                  </div>
                )}
                {riskFlags.map((flag) => (
                  <div
                    key={flag}
                    className="flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-red-700"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {flag}
                  </div>
                ))}
              </div>
              {hasLtfContent && (
                <div className="mt-3 rounded border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <Clock className="h-3.5 w-3.5" />
                    LTF snapshot
                  </div>
                  {ltf?.frames && ltf.frames.length > 0 && (
                    <p className="text-xs text-slate-600">Frames: {ltf.frames.join(', ')}</p>
                  )}
                  {ltfMetrics.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      {ltfMetrics.map((metric) => (
                        <div key={`${asset}-${metric.label}`}>
                          <p className="text-slate-500">{metric.label}</p>
                          <p className="font-semibold text-slate-700">{metric.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportsSection({ reports }: { reports: PromptReport[] }) {
  if (!reports || reports.length === 0) return null;
  return (
    <div className="space-y-3">
      {reports.map((report) => (
        <div key={report.token} className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Newspaper className="h-5 w-5 text-amber-500" />
            {report.token}
          </div>
          {report.news?.top && (
            <p className="mt-2 text-sm text-gray-700">{report.news.top}</p>
          )}
          {report.news?.items && report.news.items.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {report.news.items.map((item) => (
                <li key={item.title} className="rounded bg-gray-50 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      {item.title}
                    </a>
                    <span className="text-xs text-gray-500">
                      {item.domain ?? ''}
                      {item.pubDate ? ` · ${new Date(item.pubDate).toLocaleString()}` : ''}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
                    <span>Type: {item.eventType ?? '—'}</span>
                    <span>Polarity: {item.polarity ?? '—'}</span>
                    {typeof item.severity === 'number' && (
                      <span>Sev: {formatNumber(item.severity)}</span>
                    )}
                    {typeof item.eventConfidence === 'number' && (
                      <span>Conf: {formatNumber(item.eventConfidence)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function PreviousReportsSection({
  previousReports,
}: {
  previousReports: PromptPreviousReport[];
}) {
  if (!previousReports || previousReports.length === 0) return null;
  return (
    <div className="space-y-4">
      {previousReports.map((report) => (
        <div key={report.ts} className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <CalendarClock className="h-4 w-4" />
            <FormattedDate date={report.ts} />
          </div>
          {(report.strategyName || typeof report.pnlShiftUsd === 'number') && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
              {report.strategyName && (
                <span className="rounded bg-purple-100 px-2 py-0.5 font-semibold text-purple-700">
                  {report.strategyName}
                </span>
              )}
              {typeof report.pnlShiftUsd === 'number' && (
                <span
                  className={
                    report.pnlShiftUsd >= 0
                      ? 'font-semibold text-green-600'
                      : 'font-semibold text-red-600'
                  }
                >
                  ΔPnL: {formatCurrency(report.pnlShiftUsd)}
                </span>
              )}
            </div>
          )}
          {report.shortReport && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
              {report.shortReport}
            </p>
          )}
          {report.orders && report.orders.length > 0 && (
            <div className="mt-3">
              <h4 className="text-sm font-semibold text-gray-700">Orders</h4>
              <div className="mt-2 space-y-2">
                {report.orders.map((order, index) => (
                  <div
                    key={`${order.symbol}-${order.side}-${index}`}
                    className="flex flex-wrap items-center gap-3 rounded border border-gray-100 bg-gray-50 p-2 text-xs"
                  >
                    <span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-700">
                      {order.symbol}
                    </span>
                    <span className="uppercase text-gray-700">{order.side}</span>
                    <span>Qty: {formatNumber(order.qty)}</span>
                    {typeof order.price === 'number' && (
                      <span>Price: {formatNumber(order.price)}</span>
                    )}
                    <span>Status: {order.status}</span>
                    {order.reason && <span>Reason: {order.reason}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function RoutesSection({ routes }: { routes: PromptRoute[] }) {
  if (!routes || routes.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-semibold text-gray-600">Pair</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600">Price</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-600">
              Asset minimums
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {routes.map((route) => {
            const assets = Object.entries(route)
              .filter(([key]) => key !== 'pair' && key !== 'price')
              .filter(([, value]) =>
                typeof value === 'object' && value !== null && 'minNotional' in (value as object),
              ) as [string, PromptRouteAsset][];
            return (
              <tr key={route.pair}>
                <td className="px-3 py-2 font-semibold">{route.pair}</td>
                <td className="px-3 py-2">{formatNumber(route.price)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {assets.map(([asset, info]) => (
                      <span
                        key={asset}
                        className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                      >
                        {asset}: min {formatNumber(info.minNotional)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PromptVisualizer({ data, raw }: Props) {
  const positions = data.portfolio?.positions ?? [];
  const hasPortfolio = positions.length > 0;
  const floors = data.policy?.floor ?? {};
  const floorEntries = Object.entries(floors);
  const fearGreedIndex = data.marketData?.fearGreedIndex;
  const showFearGreed = Boolean(
    fearGreedIndex &&
      ((typeof fearGreedIndex.value === 'number' && Number.isFinite(fearGreedIndex.value)) ||
        (fearGreedIndex.classification && fearGreedIndex.classification.trim())),
  );
  const reviewIntervalLabel = formatIsoDuration(data.reviewInterval);
  const rawPnlPct = data.portfolio?.pnlPct;
  const computedPnlPct =
    typeof rawPnlPct === 'number'
      ? rawPnlPct
      : typeof data.portfolio?.pnlUsd === 'number' &&
          typeof data.portfolio?.startBalanceUsd === 'number' &&
          data.portfolio.startBalanceUsd !== 0
        ? data.portfolio.pnlUsd / data.portfolio.startBalanceUsd
        : null;

  return (
    <div className="min-h-[320px] w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <FileText className="h-5 w-5 text-indigo-600" />
            Execution Briefing
          </div>
          {data.instructions && (
            <p className="max-w-2xl text-sm text-gray-800 whitespace-pre-wrap">
              {data.instructions}
            </p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            {data.reviewInterval && (
              <span className="flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5">
                <Clock className="h-3 w-3" />
                Review every {reviewIntervalLabel ?? data.reviewInterval}
              </span>
            )}
            {data.cash && (
              <span className="flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5">
                <CircleDollarSign className="h-3 w-3" />
                Cash token: {data.cash}
              </span>
            )}
          </div>
        </div>
        {hasPortfolio && (
          <div className="rounded border border-gray-200 p-3 text-sm shadow-sm">
            <div className="flex items-center gap-2 font-semibold text-gray-700">
              <PieChart className="h-4 w-4" />
              Portfolio snapshot
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Updated{' '}
              {data.portfolio?.ts ? (
                <FormattedDate date={data.portfolio.ts} />
              ) : (
                'recently'
              )}
            </div>
            <div className="mt-2">
              <PortfolioPieChart positions={positions} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
              <span>
                Start Balance: {formatCurrency(data.portfolio?.startBalanceUsd)}
              </span>
              <span>
                PnL: {formatCurrency(data.portfolio?.pnlUsd)}{' '}
                {typeof computedPnlPct === 'number' && (
                  <span
                    className={
                      computedPnlPct >= 0
                        ? 'font-semibold text-green-600'
                        : 'font-semibold text-red-600'
                    }
                  >
                    ({formatDecimalPercent(computedPnlPct)})
                  </span>
                )}
              </span>
            </div>
          </div>
        )}
      </div>

      {floorEntries.length > 0 && (
        <div className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Policy Floors
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-gray-600">
            {floorEntries.map(([token, floor]) => (
              <span key={token} className="rounded bg-gray-100 px-2 py-1">
                {token}: {formatNumber(floor)}
              </span>
            ))}
          </div>
        </div>
      )}

      {hasPortfolio && (
        <div className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Layers3 className="h-4 w-4 text-indigo-500" />
            Positions
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Token</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Quantity</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Price (USDT)</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Value (USDT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {positions.map((position) => (
                  <tr key={position.sym}>
                    <td className="px-3 py-2 font-medium">{position.sym}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(position.qty)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(position.priceUsdt)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(position.valueUsdt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showFearGreed && fearGreedIndex && (
        <FearGreedSection fearGreedIndex={fearGreedIndex} />
      )}

      {data.marketData?.marketOverview && (
        <div className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <BarChart3 className="h-4 w-4 text-blue-500" />
            Market Overview
          </div>
          <MarketOverviewSection marketOverview={data.marketData.marketOverview} />
        </div>
      )}

      {data.routes && data.routes.length > 0 && (
        <div className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Route className="h-4 w-4 text-slate-500" />
            Routes
          </div>
          <RoutesSection routes={data.routes} />
        </div>
      )}

      {data.reports && data.reports.length > 0 && (
        <div className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Newspaper className="h-4 w-4 text-amber-500" />
            News & Reports
          </div>
          <ReportsSection reports={data.reports} />
        </div>
      )}

      {data.previousReports && data.previousReports.length > 0 && (
        <div className="rounded border border-gray-200 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <CalendarClock className="h-4 w-4 text-gray-500" />
            Previous Reviews
          </div>
          <PreviousReportsSection previousReports={data.previousReports} />
        </div>
      )}

      {raw && (
        <details className="rounded border border-dashed border-gray-300 p-3 text-xs text-gray-500">
          <summary className="cursor-pointer font-semibold">View raw JSON</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words">
            {raw}
          </pre>
        </details>
      )}
    </div>
  );
}
