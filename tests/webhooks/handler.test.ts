import { describe, expect, it } from 'vitest';
import { normalizeWebhookEvent } from '../../src/webhooks';

describe('normalizeWebhookEvent', () => {
  it('preserves known event types and explicit identifiers', () => {
    const payload = {
      id: 'evt_123',
      type: 'payment.completed',
      transactionId: 'txn_123',
      providerEventId: 'prov_evt_123',
      data: { amount: 1000 },
      timestamp: '2026-03-02T00:00:00.000Z',
    };

    const event = normalizeWebhookEvent('stripe', payload);

    expect(event.id).toBe('evt_123');
    expect(event.type).toBe('payment.completed');
    expect(event.provider).toBe('stripe');
    expect(event.transactionId).toBe('txn_123');
    expect(event.providerEventId).toBe('prov_evt_123');
    expect(event.data).toEqual({ amount: 1000 });
    expect(event.timestamp).toBe('2026-03-02T00:00:00.000Z');
  });

  it('falls back unknown event types to payment.failed', () => {
    const event = normalizeWebhookEvent('paystack', {
      id: 'evt_unknown',
      type: 'provider.custom_event',
      data: {},
    });

    expect(event.type).toBe('payment.failed');
    expect(event.provider).toBe('paystack');
  });

  it('generates missing identifiers and preserves provided raw payload', () => {
    const payload = {
      type: 'payment.pending',
      data: { status: 'queued' },
    };
    const rawPayload = '{"id":"raw_1"}';

    const event = normalizeWebhookEvent('dlocal', payload, rawPayload);

    expect(event.id).toContain('vevt_dlocal_');
    expect(event.providerEventId).toContain('pevt_');
    expect(event.rawPayload).toBe(rawPayload);
  });
});
