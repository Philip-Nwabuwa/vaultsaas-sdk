import type { VaultEvent, VaultEventType } from '../types';

const KNOWN_EVENT_TYPES: Record<VaultEventType, true> = {
  'payment.completed': true,
  'payment.failed': true,
  'payment.pending': true,
  'payment.requires_action': true,
  'payment.refunded': true,
  'payment.partially_refunded': true,
  'payment.disputed': true,
  'payment.dispute_resolved': true,
  'payout.completed': true,
  'payout.failed': true,
};

export interface ProviderWebhookPayload {
  id?: string;
  type?: string;
  transactionId?: string;
  providerEventId?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

function normalizeEventType(value?: string): VaultEventType {
  if (value && value in KNOWN_EVENT_TYPES) {
    return value as VaultEventType;
  }

  return 'payment.failed';
}

export function normalizeWebhookEvent(
  provider: string,
  payload: ProviderWebhookPayload,
  rawPayload: unknown = payload,
): VaultEvent {
  const timestamp = payload.timestamp ?? new Date().toISOString();
  const providerEventId =
    payload.providerEventId ?? payload.id ?? `pevt_${Date.now()}`;

  return {
    id: payload.id ?? `vevt_${provider}_${Date.now()}`,
    type: normalizeEventType(payload.type),
    provider,
    transactionId: payload.transactionId,
    providerEventId,
    data: payload.data ?? {},
    rawPayload,
    timestamp,
  };
}
