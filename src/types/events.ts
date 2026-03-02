export type VaultEventType =
  | 'payment.authorized'
  | 'payment.captured'
  | 'payment.failed'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'webhook.unknown';

export interface VaultEvent {
  id: string;
  type: VaultEventType;
  provider: string;
  data: unknown;
  createdAt: string;
}
