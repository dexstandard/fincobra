import type {
  AllocationSlice,
  AllocationToken,
} from './tokenAllocation.types';

export function buildFallbackSlices(
  cashToken: string | undefined,
  tokens: AllocationToken[],
): AllocationSlice[] {
  if (!cashToken) return [];

  const orderedTokens = tokens
    .map((token, index) => ({
      token: token.token.toUpperCase(),
      minAllocation: token.minAllocation,
      order: index,
    }))
    .filter((token) => token.minAllocation > 0)
    .sort((a, b) => a.order - b.order);

  const totalMin = orderedTokens.reduce((sum, token) => sum + token.minAllocation, 0);
  const remaining = Math.max(0, 100 - totalMin);

  const allocations = new Map<string, number>();
  const addSlice = (token: string, allocation: number) => {
    if (allocation <= 0) return;
    const upper = token.toUpperCase();
    allocations.set(upper, (allocations.get(upper) ?? 0) + allocation);
  };

  addSlice(cashToken, remaining);
  orderedTokens.forEach((token) => addSlice(token.token, token.minAllocation));

  return Array.from(allocations.entries()).map(([token, allocation]) => ({
    token,
    allocation,
  }));
}
