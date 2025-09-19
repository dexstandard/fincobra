export enum LimitOrderStatus {
  Open = 'open',
  Filled = 'filled',
  Canceled = 'canceled',
}

export interface LimitOrder {
  id: string;
  side: string;
  quantity: number;
  price: number;
  symbol: string;
  status: LimitOrderStatus;
  createdAt: number;
  cancellationReason?: string;
}
