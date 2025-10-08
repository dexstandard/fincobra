export interface ExchangeApiKeyDetails {
  id: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
}

export interface ExchangeApiKeyUpsert {
  userId: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
}
