import { describe, expect, it, vi } from 'vitest';
import { MockAdapter } from '../../src/testing';
import type {
  ChargeRequest,
  PaymentMethodInfo,
  PaymentResult,
  VaultEvent,
} from '../../src/types';

const chargeRequest: ChargeRequest = {
  amount: 2500,
  currency: 'USD',
  paymentMethod: {
    type: 'card',
    token: 'pm_card_visa',
  },
};

function createPaymentResult(id: string): PaymentResult {
  return {
    id,
    status: 'completed',
    provider: 'mock',
    providerId: `provider_${id}`,
    amount: 2500,
    currency: 'USD',
    paymentMethod: {
      type: 'card',
      last4: '4242',
    },
    metadata: {},
    routing: {
      source: 'local',
      reason: 'mock scenario',
    },
    createdAt: '2026-03-02T00:00:00.000Z',
    providerMetadata: {},
  };
}

describe('MockAdapter', () => {
  it('consumes deterministic scenarios before falling back to handlers', async () => {
    const fallbackCharge = vi
      .fn<(request: ChargeRequest) => Promise<PaymentResult>>()
      .mockResolvedValue(createPaymentResult('from-handler'));
    const adapter = new MockAdapter({
      handlers: {
        charge: fallbackCharge,
      },
      scenarios: {
        charge: [createPaymentResult('first'), createPaymentResult('second')],
      },
    });

    const first = await adapter.charge(chargeRequest);
    const second = await adapter.charge(chargeRequest);
    const third = await adapter.charge(chargeRequest);

    expect(first.id).toBe('first');
    expect(second.id).toBe('second');
    expect(third.id).toBe('from-handler');
    expect(fallbackCharge).toHaveBeenCalledTimes(1);
  });

  it('supports enqueueing scenarios at runtime', async () => {
    const paymentMethods: PaymentMethodInfo[] = [
      {
        type: 'card',
        provider: 'mock',
        name: 'Card',
        currencies: ['USD'],
        countries: ['US'],
      },
    ];
    const adapter = new MockAdapter();
    adapter.enqueue('listPaymentMethods', paymentMethods);

    const result = await adapter.listPaymentMethods('US', 'USD');
    expect(result).toEqual(paymentMethods);
  });

  it('rejects with configured scenario errors', async () => {
    const adapter = new MockAdapter({
      scenarios: {
        charge: [new Error('forced failure')],
      },
    });

    await expect(adapter.charge(chargeRequest)).rejects.toThrow(
      'forced failure',
    );
  });

  it('supports webhook scenarios', async () => {
    const event: VaultEvent = {
      id: 'vevt_mock_1',
      type: 'payment.completed',
      provider: 'mock',
      transactionId: 'txn_123',
      providerEventId: 'evt_123',
      data: {},
      rawPayload: '{"ok":true}',
      timestamp: '2026-03-02T00:00:00.000Z',
    };
    const adapter = new MockAdapter({
      scenarios: {
        handleWebhook: [event],
      },
    });

    await expect(adapter.handleWebhook('{"ok":true}', {})).resolves.toEqual(
      event,
    );
  });

  it('throws when no scenario or handler is configured', async () => {
    const adapter = new MockAdapter();

    await expect(adapter.capture({ transactionId: 'txn_123' })).rejects.toThrow(
      'MockAdapter handler not configured: capture',
    );
  });
});
