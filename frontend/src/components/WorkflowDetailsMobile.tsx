import WorkflowStatusLabel from './WorkflowStatusLabel';
import TokenDisplay from './TokenDisplay';
import WorkflowPnlMobile from './WorkflowPnlMobile';
import FormattedDate from './ui/FormattedDate';
import { useTranslation } from '../lib/i18n';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

interface Props {
  workflow: PortfolioWorkflow;
}

export default function WorkflowDetailsMobile({ workflow }: Props) {
  const tokens = [
    workflow.cashToken,
    ...workflow.tokens.map((t) => t.token),
  ];
  const t = useTranslation();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold truncate flex-1">
          {t('workflow')}: {workflow.name}
        </h1>
        <WorkflowStatusLabel status={workflow.status} />
      </div>
      <p className="text-sm text-gray-500">
        <FormattedDate date={workflow.createdAt} />
      </p>
      <p className="flex items-center gap-1 mt-2">
        {tokens.map((tok, i) => (
          <span key={tok} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <TokenDisplay token={tok} />
          </span>
        ))}
      </p>
      <WorkflowPnlMobile
        tokens={tokens}
        startBalanceUsd={workflow.startBalanceUsd}
      />
    </div>
  );
}
