import type { VaultEventType } from '../types';

export const DEFAULT_VAULT_EVENT_TYPES: readonly VaultEventType[] = [
  'payment.completed',
  'payment.failed',
  'payment.pending',
  'payment.requires_action',
  'payment.refunded',
  'payment.partially_refunded',
  'payment.disputed',
  'payment.dispute_resolved',
  'payout.completed',
  'payout.failed',
];
