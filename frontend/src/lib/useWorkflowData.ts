import { useQuery } from '@tanstack/react-query';
import api from './axios';
import { useUser } from './useUser';
import type { PortfolioReviewFormValues } from './constants';

export interface PortfolioWorkflow {
  id: string;
  userId: string;
  model: string | null;
  status: 'active' | 'inactive' | 'retired';
  createdAt: number;
  cashToken: string;
  tokens: { token: string; minAllocation: number }[];
  risk: PortfolioReviewFormValues['risk'];
  reviewInterval: PortfolioReviewFormValues['reviewInterval'];
  agentInstructions: string;
  startBalanceUsd: number | null;
  manualRebalance: boolean;
  useEarn: boolean;
  aiApiKeyId: string | null;
  exchangeApiKeyId: string | null;
  exchangeProvider: 'binance' | 'bybit' | null;
  ownerEmail?: string | null;
}

export function useWorkflowData(id?: string) {
  const { user } = useUser();
  return useQuery({
    queryKey: ['workflow', id, user?.id],
    queryFn: async () => {
      const res = await api.get(`/portfolio-workflows/${id}`);
      return res.data as PortfolioWorkflow;
    },
    enabled: !!id && !!user,
  });
}
