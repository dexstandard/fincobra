import { useWorkflowBalanceUsd } from '../lib/useWorkflowBalanceUsd';
import { useTranslation } from '../lib/i18n';

interface Props {
  tokens: string[];
  startBalanceUsd: number | null;
}

export default function WorkflowPnlMobile({ tokens, startBalanceUsd }: Props) {
  const t = useTranslation();
  const { balance, isLoading } = useWorkflowBalanceUsd(tokens);
  const balanceText =
    balance === null ? '-' : isLoading ? t('loading') : `$${balance.toFixed(2)}`;
  const pnl =
    balance !== null && startBalanceUsd != null ? balance - startBalanceUsd : null;
  const pnlPercent =
    pnl !== null && startBalanceUsd ? (pnl / startBalanceUsd) * 100 : null;
  const pnlText =
    pnl === null
      ? '-'
      : isLoading
      ? t('loading')
      : `${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}$${Math.abs(pnl).toFixed(2)}${
          pnlPercent !== null
            ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
            : ''
        }`;
  const pnlClass =
    pnl === null || isLoading
      ? ''
      : pnlPercent !== null
      ? pnlPercent <= -3
        ? 'text-red-600'
        : pnlPercent >= 3
        ? 'text-green-600'
        : 'text-gray-600'
      : pnl <= -0.03
      ? 'text-red-600'
      : pnl >= 0.03
      ? 'text-green-600'
      : 'text-gray-600';
  const pnlTooltip =
    pnl === null || isLoading
      ? undefined
      : `${t('pnl')} = $${balance!.toFixed(2)} - $${startBalanceUsd!.toFixed(2)} = ${
          pnl > 0 ? '+' : pnl < 0 ? '-' : ''
        }$${Math.abs(pnl).toFixed(2)}${
          pnlPercent !== null
            ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
            : ''
        }`;
  return (
    <p className="mt-2">
      <strong>{t('balance')}:</strong> {balanceText}
      <span className="ml-4">
        <strong>{t('pnl')}:</strong>{' '}
        <span className={pnlClass} title={pnlTooltip}>
          {pnlText}
        </span>
      </span>
    </p>
  );
}
