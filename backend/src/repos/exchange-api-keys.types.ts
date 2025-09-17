export interface BinanceApiKey {
  id: string | null;
  binanceApiKeyEnc: string | null;
  binanceApiSecretEnc: string | null;
}

export interface BinanceApiKeyUpsert {
  userId: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
}
