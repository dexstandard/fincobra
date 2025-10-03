import { createHash } from 'crypto';

const SIMHASH_BITS = 64;
const SIGNED_MASK = 0x7fffffffffffffffn;

function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  return matches ?? [];
}

export function computeSimhash(text: string): bigint {
  const tokens = tokenize(text);
  if (!tokens.length) {
    return 0n;
  }

  const vector = new Array<number>(SIMHASH_BITS).fill(0);

  for (const token of tokens) {
    const hash = createHash('sha256').update(token).digest();
    for (let bit = 0; bit < SIMHASH_BITS; bit++) {
      const byteIndex = Math.floor(bit / 8);
      const bitMask = 1 << (bit % 8);
      if ((hash[byteIndex] & bitMask) !== 0) {
        vector[bit] += 1;
      } else {
        vector[bit] -= 1;
      }
    }
  }

  let value = 0n;
  for (let bit = 0; bit < SIMHASH_BITS; bit++) {
    if (vector[bit] > 0) {
      value |= 1n << BigInt(bit);
    }
  }

  return value & SIGNED_MASK;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let distance = 0;
  while (diff) {
    distance += Number(diff & 1n);
    diff >>= 1n;
  }
  return distance;
}
