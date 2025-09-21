export interface BinanceApiKeyDetails {
  id: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
}

export interface BinanceApiKeyUpsert {
  userId: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
}
