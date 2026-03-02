import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PaystackAdapter } from '../../src/adapters';
import { VaultProviderError, WebhookVerificationError } from '../../src/errors';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('PaystackAdapter', () => {
  it('normalizes charge responses', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        status: true,
        message: 'Charge attempted',
        data: {
          id: 123,
          reference: 'ref_123',
          status: 'success',
          amount: 2500,
          currency: 'NGN',
          paid_at: '2026-03-02T00:00:00.000Z',
          authorization: {
            last4: '4081',
            brand: 'visa',
            exp_month: '12',
            exp_year: '2030',
          },
        },
      }),
    );
    const adapter = new PaystackAdapter({
      secretKey: 'sk_test_123',
      fetchFn,
    });

    const result = await adapter.charge({
      amount: 2500,
      currency: 'NGN',
      paymentMethod: {
        type: 'card',
        token: 'AUTH_test_123',
      },
      customer: {
        email: 'customer@example.com',
      },
    });

    expect(result.id).toBe('ref_123');
    expect(result.provider).toBe('paystack');
    expect(result.status).toBe('completed');
    expect(result.currency).toBe('NGN');
    expect(result.paymentMethod.last4).toBe('4081');
  });

  it('requires customer email for charge', async () => {
    const adapter = new PaystackAdapter({
      secretKey: 'sk_test_123',
      fetchFn: vi.fn<typeof fetch>(),
    });

    await expect(
      adapter.charge({
        amount: 2500,
        currency: 'NGN',
        paymentMethod: {
          type: 'card',
          token: 'AUTH_test_123',
        },
      }),
    ).rejects.toBeInstanceOf(VaultProviderError);
  });

  it('verifies and normalizes Paystack webhooks', async () => {
    const secret = 'whsec_123';
    const adapter = new PaystackAdapter({
      secretKey: 'sk_test_123',
      webhookSecret: secret,
      fetchFn: vi.fn<typeof fetch>(),
    });

    const payload = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 123,
        reference: 'ref_123',
        created_at: '2026-03-02T00:00:00.000Z',
      },
    });
    const signature = createHmac('sha512', secret)
      .update(payload)
      .digest('hex');

    const event = await adapter.handleWebhook(payload, {
      'x-paystack-signature': signature,
    });

    expect(event.type).toBe('payment.completed');
    expect(event.transactionId).toBe('ref_123');
  });

  it('throws for invalid Paystack webhook signature', async () => {
    const adapter = new PaystackAdapter({
      secretKey: 'sk_test_123',
      fetchFn: vi.fn<typeof fetch>(),
    });

    await expect(
      adapter.handleWebhook('{"event":"charge.success"}', {
        'x-paystack-signature': 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});
