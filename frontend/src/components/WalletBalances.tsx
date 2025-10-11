import TokenDisplay from './TokenDisplay';
import { useUser } from '../lib/useUser';
import type { BalanceInfo } from '../lib/usePrerequisites';
import { useTranslation } from '../lib/i18n';
import type { TradingMode } from '../lib/exchange.types';

const SHOW_EARN_FEATURE = false;

interface Props {
  balances: BalanceInfo[];
  exchange: 'binance' | 'bybit' | null;
  mode?: TradingMode | null;
}

export default function WalletBalances({ balances, exchange, mode }: Props) {
  const { user } = useUser();
  const t = useTranslation();

  if (!user || !exchange) {
    return null;
  }

  const title =
    exchange === 'binance'
      ? mode === 'futures'
        ? t('binance_futures_balances')
        : t('binance_balances')
      : t('bybit_futures_balances');

  return (
    <div>
      <h3 className="text-md font-bold mb-2">{title}</h3>
      {balances.map((b) => (
        <p key={b.token} className="flex flex-wrap items-center gap-1">
          <TokenDisplay token={b.token} className="font-bold shrink-0" />
          <span className="shrink-0">:</span>
          <span className="break-all">
            {b.isLoading
              ? t('loading')
              : SHOW_EARN_FEATURE
                ? `${b.walletBalance.toFixed(5)} (${t('earn')}: ${b.earnBalance.toFixed(5)})`
                : b.walletBalance.toFixed(5)}
          </span>
        </p>
      ))}
    </div>
  );
}
