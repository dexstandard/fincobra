import { useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import Modal from './ui/Modal';
import { useTranslation } from '../lib/i18n';

const MAX_LEN = 255;
function truncate(text: string) {
  return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '…' : text;
}

interface Props {
  response: {
    rebalance: boolean;
    newAllocation?: number;
    shortReport: string;
    orders?: {
      pair: string;
      token: string;
      side: string;
      quantity: number;
      limitPrice: number;
      basePrice: number;
      maxPriceDivergence: number;
    }[];
  };
  promptIcon?: ReactNode;
}

export default function ExecSuccessItem({ response, promptIcon }: Props) {
  const [showJson, setShowJson] = useState(false);
  const { rebalance, newAllocation, shortReport } = response;
  const color = rebalance
    ? 'border-green-300 bg-green-50 text-green-800'
    : 'border-blue-300 bg-blue-50 text-blue-800';
  const t = useTranslation();

  return (
    <div className={`mt-1 flex items-center gap-2 rounded border p-2 ${color}`}>
      <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">
        <span className="font-bold mr-1">
          {rebalance ? t('rebalance') : t('hold')}
        </span>
        <span>{truncate(shortReport)}</span>
        {rebalance && typeof newAllocation === 'number' && (
          <span className="ml-1">({t('new_allocation')} {newAllocation})</span>
        )}
      </div>
      {promptIcon}
      <Eye
        className="h-4 w-4 cursor-pointer"
        onClick={() => setShowJson(true)}
      />
      <Modal open={showJson} onClose={() => setShowJson(false)}>
        <pre className="whitespace-pre-wrap break-words text-sm">
          {JSON.stringify(response, null, 2)}
        </pre>
      </Modal>
    </div>
  );
}

