import { z } from 'zod';

const numericId = z.string().regex(/^\d+$/);

export const userIdParams = z.object({ id: numericId });
export const workflowIdParams = z.object({ id: numericId });
export const workflowLogIdParams = z.object({ logId: numericId });
export const workflowOrderIdParams = z.object({
  logId: numericId,
  orderId: z.string(),
});
