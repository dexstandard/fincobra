import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../lib/i18n';
import { useUser } from '../lib/useUser';
import { usePrerequisites } from '../lib/usePrerequisites';
import { parseBalanceAmount } from '../lib/parseBalanceAmount';
import type { BybitWalletCoinBalance } from '../lib/usePrerequisites.types';

interface BinanceRow {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

interface BybitRow {
  coin: string;
  total: number;
  available: number;
  equity: number;
}

function formatAmount(value: number) {
  return value.toFixed(5);
}

function mapBybitCoin(coin: BybitWalletCoinBalance): BybitRow {
  const total = parseBalanceAmount(coin.walletBalance ?? coin.equity);
  const available = parseBalanceAmount(
    coin.availableToWithdraw ??
      coin.availableToTrade ??
      coin.availableToTransfer,
  );
  const equity = parseBalanceAmount(coin.equity);
  return {
    coin: coin.coin,
    total,
    available,
    equity,
  };
}

export default function CryptoDashboard() {
  const { user } = useUser();
  const t = useTranslation();
  const {
    accountBalances,
    isAccountLoading,
    hasBinanceKey,
    hasBybitKey,
    bybitWallet,
    isBybitWalletLoading,
  } = usePrerequisites([], { includeAiKey: false });

  const binanceRows = useMemo<BinanceRow[]>(() => {
    return accountBalances
      .map((balance) => {
        const free = balance.free;
        const locked = balance.locked;
        return {
          asset: balance.asset,
          free,
          locked,
          total: free + locked,
        } satisfies BinanceRow;
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [accountBalances]);

  const bybitRows = useMemo<BybitRow[]>(() => {
    if (!bybitWallet) {
      return [];
    }
    return (bybitWallet.coin ?? [])
      .map(mapBybitCoin)
      .filter((row) => row.total > 0 || row.available > 0 || row.equity > 0)
      .sort((a, b) => b.total - a.total);
  }, [bybitWallet]);

  if (!user) {
    return <p>{t('please_log_in')}</p>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">{t('crypto_dashboard')}</h2>
      <section className="space-y-3 border rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">{t('binance_balances')}</h3>
          {!hasBinanceKey && (
            <p className="text-sm text-gray-600">
              {t('connect_binance_in_keys')}{' '}
              <Link to="/keys" className="text-blue-600 hover:underline">
                {t('keys')}
              </Link>
            </p>
          )}
        </div>
        {hasBinanceKey ? (
          isAccountLoading ? (
            <p>{t('loading')}</p>
          ) : binanceRows.length === 0 ? (
            <p className="text-sm text-gray-600">{t('no_balances')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="py-2 pr-4">{t('token')}</th>
                    <th className="py-2 pr-4">{t('available')}</th>
                    <th className="py-2 pr-4">{t('locked')}</th>
                    <th className="py-2">{t('total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {binanceRows.map((row) => (
                    <tr key={row.asset} className="border-t">
                      <td className="py-2 pr-4 font-medium">{row.asset}</td>
                      <td className="py-2 pr-4">{formatAmount(row.free)}</td>
                      <td className="py-2 pr-4">{formatAmount(row.locked)}</td>
                      <td className="py-2">{formatAmount(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
      <section className="space-y-3 border rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold">{t('bybit_balances')}</h3>
          {!hasBybitKey && (
            <p className="text-sm text-gray-600">
              {t('connect_bybit_in_keys')}{' '}
              <Link to="/keys" className="text-blue-600 hover:underline">
                {t('keys')}
              </Link>
            </p>
          )}
        </div>
        {hasBybitKey ? (
          isBybitWalletLoading ? (
            <p>{t('loading')}</p>
          ) : bybitRows.length === 0 ? (
            <p className="text-sm text-gray-600">{t('no_balances')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="py-2 pr-4">{t('token')}</th>
                    <th className="py-2 pr-4">{t('available')}</th>
                    <th className="py-2 pr-4">{t('total')}</th>
                    <th className="py-2">{t('equity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bybitRows.map((row) => (
                    <tr key={row.coin} className="border-t">
                      <td className="py-2 pr-4 font-medium">{row.coin}</td>
                      <td className="py-2 pr-4">{formatAmount(row.available)}</td>
                      <td className="py-2 pr-4">{formatAmount(row.total)}</td>
                      <td className="py-2">{formatAmount(row.equity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
