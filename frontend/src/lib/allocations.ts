export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeAllocations(
  minTokenAAllocation: number,
  minTokenBAllocation: number,
) {
  let minA = clamp(minTokenAAllocation, 0, 100);
  let minB = clamp(minTokenBAllocation, 0, 100);

  if (minA + minB > 95) {
    const excess = minA + minB - 95;
    if (minA >= minB) {
      minA -= excess;
    } else {
      minB -= excess;
    }
  }

  return {
    minTokenAAllocation: minA,
    minTokenBAllocation: minB,
  };
}
