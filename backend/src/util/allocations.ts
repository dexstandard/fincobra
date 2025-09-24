export function validateAllocations(
  tokens: { token: string; minAllocation: number }[],
) {
  let total = 0;
  for (const t of tokens) {
    if (t.minAllocation < 0 || t.minAllocation > 95)
      throw new Error('invalid minimum allocations');
    total += t.minAllocation;
  }
  if (total > 95) throw new Error('invalid minimum allocations');
  return tokens;
}
