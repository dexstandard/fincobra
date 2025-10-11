import WorkflowStatusLabel from './WorkflowStatusLabel';
import WorkflowPnlMobile from './WorkflowPnlMobile';
import FormattedDate from './ui/FormattedDate';
import WorkflowAllocationPie from './WorkflowAllocationPie';
import { useTranslation } from '../lib/i18n';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

interface Props {
  workflow: PortfolioWorkflow;
}

export default function WorkflowDetailsMobile({ workflow }: Props) {
  const tokens = [workflow.cashToken, ...workflow.tokens.map((t) => t.token)];
  const t = useTranslation();
  const isSpot = workflow.mode === 'spot';
  const modeLabel =
    workflow.mode === 'spot' ? t('spot_trading') : t('futures_trading');
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold flex-1 truncate">
          {t('workflow')}
        </h1>
        <WorkflowStatusLabel status={workflow.status} />
      </div>
      <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 inline-block px-2 py-0.5 rounded-full mb-1">
        {modeLabel}
      </div>
      <p className="text-xs text-gray-500">
        <FormattedDate date={workflow.createdAt} />
      </p>
      {workflow.status === 'active' && isSpot && (
        <WorkflowAllocationPie
          cashToken={workflow.cashToken}
          tokens={workflow.tokens}
          ownerId={workflow.userId}
        />
      )}
      {isSpot ? (
        <WorkflowPnlMobile
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
