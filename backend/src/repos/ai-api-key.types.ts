export interface AiApiKeyDetails {
  id: string;
  ai_api_key_enc: string;
}

export interface SharedAiApiKeyDetails extends AiApiKeyDetails {
  model: string | null;
}

export interface AiApiKeyRow {
  own: AiApiKeyDetails | null;
  shared: SharedAiApiKeyDetails | null;
}

export interface AiApiKeyUpsert {
  userId: string;
  apiKeyEnc: string;
}

export interface AiApiKeyShareUpsert {
  ownerUserId: string;
  targetUserId: string;
  model: string;
}

export interface AiApiKeyShareQuery {
  ownerUserId: string;
  targetUserId: string;
}
