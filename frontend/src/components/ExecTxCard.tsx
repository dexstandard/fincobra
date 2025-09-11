import { useState } from 'react';
import type { LimitOrder } from '../lib/types';
import api from '../lib/axios';
import Button from './ui/Button';

interface Props {
  agentId: string;
  logId: string;
  orders: LimitOrder[];
  onCancel?: () => Promise<unknown> | void;
}

export default function ExecTxCard({ agentId, logId, orders, onCancel }: Props) {
  const [canceling, setCanceling] = useState<string | null>(null);

  async function handleCancel(id: string) {
    setCanceling(id);
    try {
      await api.post(
        `/portfolio-workflows/${agentId}/exec-log/${logId}/orders/${id}/cancel`,
      );
      await onCancel?.();
    } finally {
      setCanceling(null);
    }
  }

  return (
    <div className="mt-2 rounded border p-2 text-sm">
      <div className="font-bold mb-1">Limit order(s)</div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            <th className="pr-2">Time</th>
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
              <td className="pr-2">{new Date(o.createdAt).toLocaleString()}</td>
              <td className="pr-2">{o.side}</td>
              <td className="pr-2">{o.quantity}</td>
              <td className="pr-2">{o.price}</td>
              <td className="pr-2">{o.status}</td>
              <td>
                {o.status === 'open' && (
                  <Button
                    variant="danger"
                    onClick={() => handleCancel(o.id)}
                    loading={canceling === o.id}
                  >
                    Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
