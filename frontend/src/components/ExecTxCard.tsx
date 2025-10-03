import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { LIMIT_ORDER_STATUS, type LimitOrder } from '../lib/types';
import api from '../lib/axios';
import Button from './ui/Button';
import Modal from './ui/Modal';
import FormattedDate from './ui/FormattedDate';
import { useTranslation } from '../lib/i18n';

interface Props {
  workflowId: string;
  logId: string;
  orders: LimitOrder[];
  onCancel?: () => Promise<unknown> | void;
}

export default function ExecTxCard({
  workflowId,
  logId,
  orders,
  onCancel,
}: Props) {
  const [canceling, setCanceling] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const t = useTranslation();

  async function handleCancel(id: string) {
    setCanceling(id);
    try {
      await api.post(
        `/portfolio-workflows/${workflowId}/exec-log/${logId}/orders/${id}/cancel`,
      );
      await onCancel?.();
    } finally {
      setCanceling(null);
    }
  }

  return (
    <div className="mt-2 rounded border p-2 text-xs sm:text-sm">
      <div className="font-bold mb-1">Limit order(s)</div>
      <table className="w-full text-left text-[0.7rem] sm:text-xs">
        <thead>
          <tr>
            <th className="hidden pr-2 sm:table-cell">Time</th>
            <th className="pr-2">Symbol</th>
            <th className="pr-2">Side</th>
            <th className="pr-2">Qty</th>
            <th className="pr-2">Price</th>
            <th className="pr-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="hidden pr-2 whitespace-nowrap sm:table-cell">
                <FormattedDate date={o.createdAt} />
              </td>
              <td className="pr-2">{o.symbol}</td>
              <td className="pr-2">{o.side}</td>
              <td className="pr-2">{o.qty}</td>
              <td className="pr-2">{o.price}</td>
              <td className="pr-2">
                {o.status}
                {o.reason && (
                  <AlertCircle
                    className="ml-1 inline h-4 w-4 text-red-600 cursor-pointer"
                    onClick={() => setErrorMsg(o.reason!)}
                  />
                )}
              </td>
              <td>
                {o.status === LIMIT_ORDER_STATUS.Open && (
                  <Button
                    aria-label="Cancel order"
                    title="Cancel order"
                    variant="danger"
                    onClick={() => handleCancel(o.id)}
                    loading={canceling === o.id}
                    className="px-2 py-1 text-[0.7rem] sm:text-xs"
                  >
                    <X className="h-4 w-4 sm:hidden" aria-hidden />
                    <span className="hidden sm:inline">Cancel</span>
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {errorMsg && (
        <Modal open onClose={() => setErrorMsg(null)}>
          <p className="mb-4">{errorMsg}</p>
          <div className="flex justify-end">
            <Button onClick={() => setErrorMsg(null)}>{t('close')}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
