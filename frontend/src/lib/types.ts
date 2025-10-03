export const LIMIT_ORDER_STATUS = {
  Open: 'open',
  Filled: 'filled',
  Canceled: 'canceled',
} as const;

export type LimitOrderStatus =
  (typeof LIMIT_ORDER_STATUS)[keyof typeof LIMIT_ORDER_STATUS];

export interface LimitOrder {
  id: string;
  side: string;
  qty: number;
  price: number;
  symbol: string;
  status: LimitOrderStatus;
  createdAt: number;
  reason?: string;
}
