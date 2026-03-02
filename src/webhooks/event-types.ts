import type { VaultEventType } from '../types';

export const DEFAULT_VAULT_EVENT_TYPES: readonly VaultEventType[] = [
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'refund.succeeded',
  'refund.failed',
  'webhook.unknown',
];
