export interface AiApiKeyDetails {
  id: string;
  aiApiKeyEnc: string;
}

export interface SharedAiApiKeyDetails extends AiApiKeyDetails {
  model: string | null;
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

export interface AiApiKeyShareDelete {
  ownerUserId: string;
  targetUserId: string;
}

export interface AiApiKeyShareLookup {
  ownerUserId: string;
  targetUserId: string;
}
