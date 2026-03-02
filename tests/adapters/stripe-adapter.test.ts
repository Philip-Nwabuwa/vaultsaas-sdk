import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { StripeAdapter } from '../../src/adapters';
import { VaultClient } from '../../src/client';
import { WebhookVerificationError } from '../../src/errors';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'request-id': 'req_123',
    },
  });
}

describe('StripeAdapter', () => {
  it('normalizes charge responses', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        id: 'pi_123',
        status: 'succeeded',
        amount: 2500,
        currency: 'usd',
        created: 1_777_777_777,
      }),
    );
    const adapter = new StripeAdapter({
      apiKey: 'sk_test_123',
      fetchFn,
    });

    const result = await adapter.charge({
      amount: 2500,
      currency: 'USD',
      paymentMethod: {
        type: 'card',
        number: '4242424242424242',
        expMonth: 12,
        expYear: 2030,
        cvc: '123',
      },
    });

    expect(result.id).toBe('pi_123');
    expect(result.status).toBe('completed');
    expect(result.provider).toBe('stripe');
    expect(result.currency).toBe('USD');
    expect(result.paymentMethod.last4).toBe('4242');

    const requestInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit?.method).toBe('POST');
    expect(String(requestInit?.body)).toContain('capture_method=automatic');
  });

  it('verifies and normalizes Stripe webhooks', async () => {
    const webhookSecret = 'whsec_test_123';
    const adapter = new StripeAdapter({
      apiKey: 'sk_test_123',
      webhookSecret,
      fetchFn: vi.fn<typeof fetch>(),
    });
    const payload = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      created: 1_777_777_777,
      data: {
        object: {
          id: 'pi_123',
        },
      },
    });
    const timestamp = '1777777777';
    const signature = createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const event = await adapter.handleWebhook(payload, {
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    });

    expect(event.type).toBe('payment.completed');
    expect(event.transactionId).toBe('pi_123');
  });

  it('throws for invalid Stripe webhook signature', async () => {
    const adapter = new StripeAdapter({
      apiKey: 'sk_test_123',
      webhookSecret: 'whsec_test_123',
      fetchFn: vi.fn<typeof fetch>(),
    });

    await expect(
      adapter.handleWebhook('{"id":"evt_1"}', {
        'stripe-signature': 't=1777777777,v1=deadbeef',
      }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('maps Stripe provider errors to canonical Vault errors through VaultClient', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse(
        {
          error: {
            code: 'card_declined',
            message: 'Your card was declined.',
            decline_code: 'insufficient_funds',
            type: 'card_error',
          },
        },
        402,
      ),
    );

    const client = new VaultClient({
      providers: {
        stripe: {
          adapter: StripeAdapter,
          config: {
            apiKey: 'sk_test_123',
            fetchFn,
          },
        },
      },
      routing: {
        rules: [{ match: { default: true }, provider: 'stripe' }],
      },
    });

    await expect(
      client.charge({
        amount: 2500,
        currency: 'USD',
        paymentMethod: {
          type: 'card',
          token: 'pm_card_visa',
        },
        customer: {
          email: 'test@example.com',
        },
      }),
    ).rejects.toMatchObject({
      code: 'CARD_DECLINED',
      category: 'card_declined',
      context: {
        provider: 'stripe',
        operation: 'charge',
      },
    });
  });
});
