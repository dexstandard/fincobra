import { useWorkflowBalanceUsd } from '../lib/useWorkflowBalanceUsd';
import { useTranslation } from '../lib/i18n';

interface Props {
  tokens: string[];
  userId?: string;
}

export default function WorkflowBalance({ tokens, userId }: Props) {
  const t = useTranslation();
  const { balance, isLoading } = useWorkflowBalanceUsd(tokens, userId);
  if (balance === null) return <span>-</span>;
  return <span>{isLoading ? t('loading') : `$${balance.toFixed(2)}`}</span>;
}
