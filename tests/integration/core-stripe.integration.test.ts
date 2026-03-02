import { describe, expect, it, vi } from 'vitest';
import { StripeAdapter } from '../../src/adapters';
import { VaultClient } from '../../src/client';

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'request-id': 'req_integration',
    },
  });
}

describe('VaultClient + StripeAdapter integration', () => {
  it('runs a charge -> getStatus -> refund flow through the core client', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.includes('/v1/payment_intents') && method === 'POST') {
          return createJsonResponse({
            id: 'pi_int_1',
            status: 'succeeded',
            amount: 3200,
            currency: 'usd',
            created: 1_777_777_777,
          });
        }

        if (url.includes('/v1/payment_intents/pi_int_1') && method === 'GET') {
          return createJsonResponse({
            id: 'pi_int_1',
            status: 'succeeded',
            amount: 3200,
            currency: 'usd',
            created: 1_777_777_778,
          });
        }

        if (url.includes('/v1/refunds') && method === 'POST') {
          return createJsonResponse({
            id: 're_int_1',
            payment_intent: 'pi_int_1',
            status: 'succeeded',
            amount: 3200,
            currency: 'usd',
            created: 1_777_777_779,
          });
        }

        throw new Error(`Unexpected Stripe request: ${method} ${url}`);
      });

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

    const charge = await client.charge({
      amount: 3200,
      currency: 'USD',
      paymentMethod: {
        type: 'card',
        token: 'pm_card_visa',
      },
      customer: {
        email: 'integration@example.com',
      },
    });

    expect(charge.status).toBe('completed');
    expect(charge.provider).toBe('stripe');
    expect(charge.id).toBe('pi_int_1');

    const status = await client.getStatus(charge.id);
    expect(status.status).toBe('completed');
    expect(status.provider).toBe('stripe');
    expect(status.id).toBe('pi_int_1');

    const refund = await client.refund({
      transactionId: charge.id,
    });
    expect(refund.status).toBe('completed');
    expect(refund.provider).toBe('stripe');
    expect(refund.transactionId).toBe('pi_int_1');
  });

  it('runs an authorize -> capture flow through the core client', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';

        if (url.endsWith('/v1/payment_intents') && method === 'POST') {
          const body = String(init?.body ?? '');
          const captureMethod = new URLSearchParams(body).get('capture_method');

          if (captureMethod === 'manual') {
            return createJsonResponse({
              id: 'pi_auth_1',
              status: 'requires_capture',
              amount: 1500,
              currency: 'usd',
              created: 1_777_777_780,
            });
          }
        }

        if (
          url.endsWith('/v1/payment_intents/pi_auth_1/capture') &&
          method === 'POST'
        ) {
          return createJsonResponse({
            id: 'pi_auth_1',
            status: 'succeeded',
            amount: 1500,
            currency: 'usd',
            created: 1_777_777_781,
          });
        }

        throw new Error(`Unexpected Stripe request: ${method} ${url}`);
      });

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

    const authorized = await client.authorize({
      amount: 1500,
      currency: 'USD',
      paymentMethod: {
        type: 'card',
        token: 'pm_card_visa',
      },
      customer: {
        email: 'integration@example.com',
      },
    });

    expect(authorized.status).toBe('authorized');
    expect(authorized.provider).toBe('stripe');
    expect(authorized.id).toBe('pi_auth_1');

    const captured = await client.capture({
      transactionId: authorized.id,
    });

    expect(captured.status).toBe('completed');
    expect(captured.provider).toBe('stripe');
    expect(captured.id).toBe('pi_auth_1');
  });
});
