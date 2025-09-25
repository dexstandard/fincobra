export const CANCEL_ORDER_REASONS = {
  API_KEY_REMOVED: 'API key removed',
  WORKFLOW_DELETED: 'Workflow deleted',
  WORKFLOW_STOPPED: 'Workflow stopped',
} as const;

export type CancelOrderReason =
  (typeof CANCEL_ORDER_REASONS)[keyof typeof CANCEL_ORDER_REASONS];
