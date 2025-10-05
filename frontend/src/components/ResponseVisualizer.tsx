import { CheckCircle, ClipboardList, FileText } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from '../lib/i18n';
import type { ResponseData, ResponseOrder } from './ResponseVisualizer.types';

interface Props {
  data: ResponseData;
}

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

function formatPercent(value?: number): string {
  if (typeof value !== 'number') return '—';
  return `${percentFormatter.format(value * 100)}%`;
}

function normalizeOrders(orders: ResponseOrder[] | undefined): ResponseOrder[] {
  if (!orders || orders.length === 0) return [];
  return orders.map((order) => ({
    pair: order.pair,
    token: order.token,
    side: order.side,
    qty: order.qty,
    limitPrice: order.limitPrice,
    basePrice: order.basePrice,
    maxPriceDriftPct: order.maxPriceDriftPct,
  }));
}

export default function ResponseVisualizer({ data }: Props) {
  const t = useTranslation();
  const orders = useMemo(() => normalizeOrders(data.orders), [data.orders]);

  return (
    <div className="space-y-4">
      <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
          <CheckCircle className="h-4 w-4" />
          <span>{t('decision')}</span>
        </div>
        <div
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
            data.rebalance
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-blue-50 text-blue-700 border border-blue-200'
          }`}
        >
          {data.rebalance ? t('rebalance') : t('hold')}
        </div>
      </div>

      {data.shortReport && (
        <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
            <FileText className="h-4 w-4" />
            <span>{t('short_report')}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{data.shortReport}</p>
        </div>
      )}

      <div className="rounded border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
          <ClipboardList className="h-4 w-4" />
          <span>{t('orders')}</span>
        </div>
        {orders.length === 0 ? (
          <p className="text-sm text-gray-600">{t('no_orders')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full table-fixed text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">
                    {t('pair')}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">
                    {t('token')}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">
                    {t('side')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">
                    {t('quantity')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">
                    {t('limit_price')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">
                    {t('base_price')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">
                    {t('max_price_drift_pct')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {orders.map((order, index) => (
                  <tr key={`${order.pair ?? 'order'}-${index}`}>
                    <td className="px-3 py-2 text-gray-700">{order.pair ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{order.token ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{order.side ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatNumber(order.qty)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatNumber(order.limitPrice)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatNumber(order.basePrice)}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {formatPercent(order.maxPriceDriftPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
