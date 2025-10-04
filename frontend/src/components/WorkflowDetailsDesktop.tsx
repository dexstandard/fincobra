import { useTranslation } from '../lib/i18n';
import WorkflowStatusLabel from './WorkflowStatusLabel';
import TokenDisplay from './TokenDisplay';
import WorkflowPnl from './WorkflowPnl';
import FormattedDate from './ui/FormattedDate';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

interface Props {
  workflow: PortfolioWorkflow;
}

export default function WorkflowDetailsDesktop({ workflow }: Props) {
  const t = useTranslation();

  const tokens = [workflow.cashToken, ...workflow.tokens.map((t) => t.token)];
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-xl font-semibold">{t('workflow')}</h1>
        <WorkflowStatusLabel status={workflow.status} />
      </div>
      <div className="text-sm text-gray-500">
        <FormattedDate date={workflow.createdAt} />
      </div>
      <div className="flex items-center gap-1 mt-2 text-sm text-gray-600">
        {tokens.map((tok, i) => (
          <span key={tok} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <TokenDisplay token={tok} />
          </span>
        ))}
      </div>
      <WorkflowPnl
        tokens={tokens}
        startBalanceUsd={workflow.startBalanceUsd}
        userId={workflow.userId}
      />
    </div>
  );
}
