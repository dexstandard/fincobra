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
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold flex-1 truncate">
          {t('workflow')}
        </h1>
        <WorkflowStatusLabel status={workflow.status} />
      </div>
      <p className="text-xs text-gray-500">
        <FormattedDate date={workflow.createdAt} />
      </p>
      {workflow.status === 'active' && (
        <WorkflowAllocationPie
          cashToken={workflow.cashToken}
          tokens={workflow.tokens}
          ownerId={workflow.userId}
        />
      )}
      <WorkflowPnlMobile
        tokens={tokens}
        startBalanceUsd={workflow.startBalanceUsd}
        userId={workflow.userId}
      />
    </div>
  );
}
