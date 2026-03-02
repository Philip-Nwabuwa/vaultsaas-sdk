import type { VaultEvent, VaultEventType } from '../types';

export interface ProviderWebhookPayload {
  id?: string;
  type?: string;
  data?: unknown;
  createdAt?: string;
}

export function normalizeWebhookEvent(
  provider: string,
  payload: ProviderWebhookPayload,
): VaultEvent {
  return {
    id: payload.id ?? `${provider}-${Date.now()}`,
    type: (payload.type ?? 'webhook.unknown') as VaultEventType,
    provider,
    data: payload.data ?? payload,
    createdAt: payload.createdAt ?? new Date().toISOString(),
  };
}
