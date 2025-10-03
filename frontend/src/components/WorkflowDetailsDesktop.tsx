import { useState } from 'react';
import { useTranslation } from '../lib/i18n';
import { Eye, EyeOff } from 'lucide-react';
import WorkflowStatusLabel from './WorkflowStatusLabel';
import TokenDisplay from './TokenDisplay';
import WorkflowPnl from './WorkflowPnl';
import FormattedDate from './ui/FormattedDate';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

interface Props {
  workflow: PortfolioWorkflow;
}

export default function WorkflowDetailsDesktop({ workflow }: Props) {
  const [showPrompt, setShowPrompt] = useState(false);
  const t = useTranslation();

  const tokens = [workflow.cashToken, ...workflow.tokens.map((t) => t.token)];
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <span>{t('workflow')}:</span> <span>{workflow.name}</span>
      </h1>
      <p className="mt-2">
        <strong>{t('created')}:</strong>{' '}
        <FormattedDate date={workflow.createdAt} />
      </p>
      <p className="mt-2">
        <strong>{t('status')}:</strong>{' '}
        <WorkflowStatusLabel status={workflow.status} />
      </p>
      <p className="flex items-center gap-1 mt-2">
        <strong>{t('tokens')}:</strong>
        {tokens.map((tok, i) => (
          <span key={tok} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <TokenDisplay token={tok} />
          </span>
        ))}
      </p>
      <div className="mt-2">
        <div className="flex items-center gap-1">
          <h2 className="text-l font-bold">{t('trading_instructions')}</h2>
          {showPrompt ? (
            <EyeOff
              className="w-4 h-4 cursor-pointer"
              onClick={() => setShowPrompt(false)}
            />
          ) : (
            <Eye
              className="w-4 h-4 cursor-pointer"
              onClick={() => setShowPrompt(true)}
            />
          )}
        </div>
        {showPrompt && (
          <pre className="whitespace-pre-wrap mt-2">
            {workflow.agentInstructions}
          </pre>
        )}
      </div>
      <WorkflowPnl
        tokens={tokens}
        startBalanceUsd={workflow.startBalanceUsd}
        userId={workflow.userId}
      />
    </div>
  );
}
