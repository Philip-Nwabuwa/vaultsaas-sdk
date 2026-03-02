export type VaultEventType =
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.pending'
  | 'payment.requires_action'
  | 'payment.refunded'
  | 'payment.partially_refunded'
  | 'payment.disputed'
  | 'payment.dispute_resolved'
  | 'payout.completed'
  | 'payout.failed';

export interface VaultEvent {
  id: string;
  type: VaultEventType;
  provider: string;
  transactionId?: string;
  providerEventId: string;
  data: Record<string, unknown>;
  rawPayload: unknown;
  timestamp: string;
}
