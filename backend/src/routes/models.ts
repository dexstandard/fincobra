import type { FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import NodeCache from 'node-cache';
import { RATE_LIMITS } from '../rate-limit.js';
import { getAiKey, getSharedAiKey } from '../repos/ai-api-key.js';
import type {
    AiApiKeyDetails,
    SharedAiApiKeyDetails,
} from '../repos/ai-api-key.types.js';
import { fetchSupportedModels } from '../services/ai.js';
import { decryptKey } from '../util/crypto.js';
import { errorResponse, ERROR_MESSAGES } from '../util/errorMessages.js';
import { getValidatedUserId, userPreHandlers } from './_shared/guards.js';

const CACHE_TTL_SEC = 6 * 60 * 60;
const MODEL_FETCH_ERROR = 'failed to fetch models';

const modelsCache = new NodeCache({
    stdTTL: CACHE_TTL_SEC,
    checkperiod: Math.max(60, Math.floor(CACHE_TTL_SEC / 6)),
});

function sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
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

            const restricted = getRestrictedSharedModels(ownKey, sharedKey);
            if (restricted) return { models: restricted };

            const encryptedKey = getEncryptedKey(ownKey, sharedKey);
            if (!encryptedKey)
                return reply.code(404).send(errorResponse(ERROR_MESSAGES.notFound));

            const apiKey = decryptKey(encryptedKey);
            const cacheKey = sha256(apiKey);

            const cached = modelsCache.get<string[]>(cacheKey);
            if (cached) return { models: cached };

            const models = await fetchSupportedModels(apiKey);
            if (models === null)
                return reply.code(502).send(errorResponse(MODEL_FETCH_ERROR));

            modelsCache.set(cacheKey, models);
            return { models };
        },
    );
}
