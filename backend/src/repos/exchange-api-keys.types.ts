export interface BinanceApiKeyRow {
  id: string | null;
  binance_api_key_enc: string | null;
  binance_api_secret_enc: string | null;
}

export interface BinanceApiKeyUpsert {
  userId: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
}
