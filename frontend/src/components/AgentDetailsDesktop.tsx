import { useState } from 'react';
import { useTranslation } from '../lib/i18n';
import { Eye, EyeOff } from 'lucide-react';
import AgentStatusLabel from './AgentStatusLabel';
import TokenDisplay from './TokenDisplay';
import AgentPnl from './AgentPnl';
import FormattedDate from './ui/FormattedDate';
import DerivativesSummary from './DerivativesSummary';
import type { Agent } from '../lib/useAgentData';

interface Props {
  agent: Agent;
}

export default function AgentDetailsDesktop({ agent }: Props) {
  const [showPrompt, setShowPrompt] = useState(false);
  const t = useTranslation();

  const tokens = [agent.cashToken, ...agent.tokens.map((t) => t.token)];
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <span>{t('agent')}:</span> <span>{agent.name}</span>
      </h1>
      <p className="mt-2">
        <strong>{t('created')}:</strong> <FormattedDate date={agent.createdAt} />
      </p>
      <p className="mt-2">
        <strong>{t('status')}:</strong> <AgentStatusLabel status={agent.status} />
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
      <DerivativesSummary symbol={`${agent.tokens[0]?.token.toUpperCase() ?? ''}${agent.cashToken.toUpperCase()}`} />
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
            {agent.agentInstructions}
          </pre>
        )}
      </div>
      <AgentPnl tokens={tokens} startBalanceUsd={agent.startBalanceUsd} />
    </div>
  );
}
