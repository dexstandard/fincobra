import { useEffect, useRef } from 'react';
import { useTranslation } from '../../lib/i18n';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { createChart, LineSeries } from 'lightweight-charts';
import type { ISeriesApi, UTCTimestamp } from 'lightweight-charts';

type PricePoint = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

function generateStablecoinData(): PricePoint[] {
  const now = Date.now();
  return Array.from({ length: 365 }, (_, i) => ({
    time: now - (364 - i) * 24 * 60 * 60 * 1000,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
  }));
}

type Kline = [number, string, string, string, string, ...unknown[]];

async function fetchHistory(token: string): Promise<PricePoint[]> {
  const symbol = token.toUpperCase();
  const res = await axios.get<Kline[]>(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}USDT&interval=1d&limit=365`,
  );
  return res.data.map((d) => ({
    time: d[0],
    open: Number(d[1]),
    high: Number(d[2]),
    low: Number(d[3]),
    close: Number(d[4]),
  }));
}

export default function PriceChart({ tokens }: { tokens: string[] }) {
  const [token1, token2] = tokens;
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesARef = useRef<ISeriesApi<'Line'> | null>(null);
  const seriesBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const t = useTranslation();

  const query = useQuery<{ [key: string]: PricePoint[] }>({
    queryKey: ['price-history', token1, token2],
    queryFn: async () => {
      const data1 = ['USDT', 'USDC'].includes(token1)
        ? generateStablecoinData()
        : await fetchHistory(token1);
      const data2 = ['USDT', 'USDC'].includes(token2)
        ? generateStablecoinData()
        : await fetchHistory(token2);
      return { [token1]: data1, [token2]: data2 };
    },
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      rightPriceScale: { visible: true },
      leftPriceScale: { visible: true },
      layout: { background: { color: 'transparent' }, textColor: 'black' },
    });

    const seriesA = chart.addSeries(LineSeries, {
      priceScaleId: 'left',
      color: '#2962FF',
    });
    const seriesB = chart.addSeries(LineSeries, {
      priceScaleId: 'right',
      color: '#D32F2F',
    });
    seriesARef.current = seriesA;
    seriesBRef.current = seriesB;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!query.data || !seriesARef.current || !seriesBRef.current) return;

    seriesARef.current.setData(
      query.data[token1].map((d) => ({
        time: (d.time / 1000) as UTCTimestamp,
        value: d.close,
      })),
    );
    seriesBRef.current.setData(
      query.data[token2].map((d) => ({
        time: (d.time / 1000) as UTCTimestamp,
        value: d.close,
      })),
    );
  }, [query.data, token1, token2]);

  return (
    <div className="bg-white shadow-md border border-gray-200 rounded p-6 flex-1 min-w-0 flex flex-col">
      <h2 className="text-xl font-bold mb-4">{t('price_history')}</h2>
      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0" />
        {query.isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            {t('loading')}
          </div>
        )}
        {query.isError && (
          <div className="absolute inset-0 flex items-center justify-center text-red-500">
            {t('failed_load_price_data')}
          </div>
        )}
      </div>
    </div>
  );
}
