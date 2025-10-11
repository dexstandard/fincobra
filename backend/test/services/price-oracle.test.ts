import { beforeEach, describe, expect, it, vi } from 'vitest';

const decimalsMock = vi.fn();
const latestRoundDataMock = vi.fn();
const contractInstances: { address: string; provider: unknown }[] = [];

vi.mock('ethers', () => {
  class MockContract {
    public readonly address: string;
    public readonly provider: unknown;
    constructor(address: string, _abi: readonly string[], provider: unknown) {
      this.address = address;
      this.provider = provider;
      contractInstances.push({ address, provider });
    }

    decimals = decimalsMock;
    latestRoundData = latestRoundDataMock;
  }

  const JsonRpcProvider = vi.fn();

  return {
    Contract: MockContract,
    JsonRpcProvider,
  };
});

process.env.KEY_PASSWORD ??= 'test-key-password';
process.env.GOOGLE_CLIENT_ID ??= 'test-client-id.apps.googleusercontent.com';

const serviceModule = await import('../../src/services/price-oracle.js');
const ethersModule = await import('ethers');
const { getUsdPrice, setPriceOracleProvider, clearPriceOracleCache } = serviceModule;
const { JsonRpcProvider } = ethersModule;

describe('price oracle service', () => {
  beforeEach(() => {
    decimalsMock.mockReset();
    latestRoundDataMock.mockReset();
    contractInstances.length = 0;
    clearPriceOracleCache();
    setPriceOracleProvider(null);
    vi.mocked(JsonRpcProvider).mockClear();
  });

  it('uses the default public RPC when no provider override is set', async () => {
    decimalsMock.mockResolvedValue(8);
    latestRoundDataMock.mockResolvedValue({
      answer: 100_000_000n,
      updatedAt: 1_700_000_000n,
    });

    await getUsdPrice('USDT');

    expect(JsonRpcProvider).toHaveBeenCalledWith('https://eth.llamarpc.com');
  });

  it('returns and caches oracle prices', async () => {
    const mockProvider = { id: 'mock' } as const;
    setPriceOracleProvider(mockProvider);

    decimalsMock.mockResolvedValue(8);
    latestRoundDataMock.mockResolvedValue({
      answer: 100_000_000n,
      updatedAt: 1_700_000_000n,
    });

    const firstQuote = await getUsdPrice('USDT');
    expect(firstQuote.price).toBeCloseTo(1);
    expect(firstQuote.symbol).toBe('USDT');
    expect(latestRoundDataMock).toHaveBeenCalledTimes(1);
    expect(decimalsMock).toHaveBeenCalledTimes(1);
    expect(contractInstances[0]?.address).toBe('0x3e7d1eab13ad0104d2750b8863b489d65364e32d');
    expect(contractInstances[0]?.provider).toBe(mockProvider);

    const secondQuote = await getUsdPrice('USDT');
    expect(secondQuote.price).toBe(firstQuote.price);
    expect(latestRoundDataMock).toHaveBeenCalledTimes(1);
    expect(decimalsMock).toHaveBeenCalledTimes(1);
  });

  it('throws when oracle reports a non-positive price', async () => {
    const mockProvider = {};
    setPriceOracleProvider(mockProvider);

    decimalsMock.mockResolvedValue(8);
    latestRoundDataMock.mockResolvedValue({
      answer: 0n,
      updatedAt: 1_700_000_000n,
    });

    await expect(getUsdPrice('USDC')).rejects.toThrow('Oracle price for USDC is not positive');
  });
});
