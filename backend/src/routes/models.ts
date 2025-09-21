import type { FastifyInstance } from 'fastify';
import { RATE_LIMITS } from '../rate-limit.js';
import { getAiKey, getSharedAiKey } from '../repos/ai-api-key.js';
import type {
  AiApiKeyDetails,
  SharedAiApiKeyDetails,
} from '../repos/ai-api-key.types.js';
import { decryptKey } from '../util/api-keys.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODEL_FETCH_ERROR = 'failed to fetch models';

interface OpenAiModel {
  id: string;
}

interface ModelsCacheEntry {
  models: string[];
  expiresAt: number;
}

const modelsCache = new Map<string, ModelsCacheEntry>();

function getCachedModels(key: string): string[] | undefined {
  const entry = modelsCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    modelsCache.delete(key);
    return undefined;
  }
  return entry.models;
}

function setCachedModels(key: string, models: string[]): void {
  modelsCache.set(key, { models, expiresAt: Date.now() + CACHE_TTL_MS });
}

function getRestrictedSharedModels(
  ownKey: AiApiKeyDetails | null | undefined,
  sharedKey: SharedAiApiKeyDetails | null | undefined,
): string[] | null {
  if (!ownKey && sharedKey?.model) return [sharedKey.model];
  return null;
}

function getEncryptedKey(
  ownKey: AiApiKeyDetails | null | undefined,
  sharedKey: SharedAiApiKeyDetails | null | undefined,
): string | null {
  return ownKey?.aiApiKeyEnc ?? sharedKey?.aiApiKeyEnc ?? null;
}

function filterSupportedModels(models: OpenAiModel[]): string[] {
  return models
    .map((model) => model.id)
    .filter(
      (id) =>
        id.startsWith('gpt-5') || id.startsWith('o3') || id.includes('search'),
    );
}

async function fetchSupportedModels(apiKey: string): Promise<string[] | null> {
  try {
    const res = await fetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: OpenAiModel[] };
    return filterSupportedModels(body.data ?? []);
  } catch {
    return null;
  }
}

export default async function modelsRoutes(app: FastifyInstance) {
  app.get(
    '/users/:id/models',
    {
      config: { rateLimit: RATE_LIMITS.MODERATE },
      preHandler: userPreHandlers,
    },
    async (req, reply) => {
      const userId = getValidatedUserId(req);
      const [ownKey, sharedKey] = await Promise.all([
        getAiKey(userId),
        getSharedAiKey(userId),
      ]);

      const restrictedModels = getRestrictedSharedModels(ownKey, sharedKey);
      if (restrictedModels) return { models: restrictedModels };

      const encryptedKey = getEncryptedKey(ownKey, sharedKey);
      if (!encryptedKey)
        return reply
          .code(404)
          .send(errorResponse(ERROR_MESSAGES.notFound));

      const apiKey = decryptKey(encryptedKey);
      const cachedModels = getCachedModels(apiKey);
      if (cachedModels !== undefined) return { models: cachedModels };

      const models = await fetchSupportedModels(apiKey);
      if (models === null)
        return reply.code(500).send(errorResponse(MODEL_FETCH_ERROR));

      setCachedModels(apiKey, models);
      return { models };
    },
  );
}
