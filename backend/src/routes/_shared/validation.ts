import { z } from 'zod';

export const userIdParams = z.object({ id: z.string().regex(/^\d+$/) });
