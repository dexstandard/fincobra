import AgentStatusLabel from './AgentStatusLabel';
import TokenDisplay from './TokenDisplay';
import AgentPnlMobile from './AgentPnlMobile';
import FormattedDate from './ui/FormattedDate';
import DerivativesSummary from './DerivativesSummary';
import type { Agent } from '../lib/useAgentData';

interface Props {
  agent: Agent;
}

export default function AgentDetailsMobile({ agent }: Props) {
  const tokens = [agent.cashToken, ...agent.tokens.map((t) => t.token)];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold truncate flex-1">Agent: {agent.name}</h1>
        <AgentStatusLabel status={agent.status} />
      </div>
      <p className="text-sm text-gray-500">
        <FormattedDate date={agent.createdAt} />
      </p>
      <p className="flex items-center gap-1 mt-2">
        {tokens.map((tok, i) => (
          <span key={tok} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <TokenDisplay token={tok} />
          </span>
        ))}
      </p>
      <DerivativesSummary symbol={`${agent.tokens[0]?.token.toUpperCase() ?? ''}${agent.cashToken.toUpperCase()}`} />
      <AgentPnlMobile tokens={tokens} startBalanceUsd={agent.startBalanceUsd} />
    </div>
  );
}
