import { useTranslation } from '../lib/i18n';
import WorkflowStatusLabel from './WorkflowStatusLabel';
import WorkflowPnl from './WorkflowPnl';
import FormattedDate from './ui/FormattedDate';
import WorkflowAllocationPie from './WorkflowAllocationPie';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

interface Props {
  workflow: PortfolioWorkflow;
}

export default function WorkflowDetailsDesktop({ workflow }: Props) {
  const t = useTranslation();

  const tokens = [workflow.cashToken, ...workflow.tokens.map((t) => t.token)];
  const isSpot = workflow.mode === 'spot';
  const modeLabel =
    workflow.mode === 'spot' ? t('spot_trading') : t('futures_trading');
  return (
    <div>
      <div className="flex items-center flex-wrap gap-2 mb-1">
        <h1 className="text-xl font-semibold">{t('workflow')}</h1>
        <span className="rounded-full bg-blue-50 px-3 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
          {modeLabel}
        </span>
        <WorkflowStatusLabel status={workflow.status} />
      </div>
      <div className="text-sm text-gray-500">
        <FormattedDate date={workflow.createdAt} />
      </div>
      {workflow.status === 'active' && isSpot && (
        <WorkflowAllocationPie
          cashToken={workflow.cashToken}
          tokens={workflow.tokens}
          ownerId={workflow.userId}
        />
      )}
      {isSpot ? (
        <WorkflowPnl
          tokens={tokens}
          startBalanceUsd={workflow.startBalanceUsd}
          userId={workflow.userId}
        />
      ) : (
        <p className="mt-2 text-sm text-gray-600">
          {t('futures_metrics_unavailable')}
        </p>
      )}
    </div>
  );
}
