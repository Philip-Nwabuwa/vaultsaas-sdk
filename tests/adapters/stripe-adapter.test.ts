import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { StripeAdapter } from '../../src/adapters';
import { VaultClient } from '../../src/client';
import { VaultConfigError, WebhookVerificationError } from '../../src/errors';
import {
  createSignedWebhookPayload,
  createStripeSignedWebhookPayload,
} from '../../src/testing/webhook-helper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'request-id': 'req_123',
    },
  });
}

function makeAdapter(overrides: Record<string, unknown> = {}): {
  adapter: StripeAdapter;
  fetchFn: ReturnType<typeof vi.fn>;
} {
  const fetchFn = vi.fn<typeof fetch>();
  const adapter = new StripeAdapter({
    apiKey: 'sk_test_123',
    fetchFn,
    ...overrides,
  });
  return { adapter, fetchFn };
}

const CARD_RAW: {
  type: 'card';
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
} = {
  type: 'card',
  number: '4242424242424242',
  expMonth: 12,
  expYear: 2030,
  cvc: '123',
};

const CARD_TOKEN: { type: 'card'; token: string } = {
  type: 'card',
  token: 'pm_card_visa',
};

function stripeIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_123',
    status: 'succeeded',
    amount: 2500,
    currency: 'usd',
    created: 1_777_777_777,
    latest_charge: 'ch_abc',
    payment_method: 'pm_xyz',
    metadata: {},
    ...overrides,
  };
}

function validStripeSignature(payload: string, secret: string): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('StripeAdapter', () => {
  describe('constructor', () => {
    it('throws VaultConfigError when apiKey is missing', () => {
      expect(() => new StripeAdapter({})).toThrow(VaultConfigError);
    });

    it('throws VaultConfigError when apiKey is empty string', () => {
      expect(() => new StripeAdapter({ apiKey: '   ' })).toThrow(
        VaultConfigError,
      );
    });

    it('accepts a valid apiKey', () => {
      const adapter = new StripeAdapter({ apiKey: 'sk_test_123' });
      expect(adapter.name).toBe('stripe');
    });

    it('uses custom baseUrl when provided', async () => {
      const { adapter, fetchFn } = makeAdapter({
        baseUrl: 'https://custom.stripe.local',
      });
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));
      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });
      const url = fetchFn.mock.calls[0]?.[0] as string;
      expect(url).toContain('https://custom.stripe.local');
    });

    it('defaults to stripe API base URL', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));
      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });
      const url = fetchFn.mock.calls[0]?.[0] as string;
      expect(url).toContain('https://api.stripe.com');
    });
  });

  // -------------------------------------------------------------------------
  // charge()
  // -------------------------------------------------------------------------

  describe('charge()', () => {
    it('normalizes a successful charge response', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      const result = await adapter.charge({
        amount: 2500,
        currency: 'USD',
        paymentMethod: CARD_RAW,
      });

      expect(result.id).toBe('pi_123');
      expect(result.status).toBe('completed');
      expect(result.provider).toBe('stripe');
      expect(result.providerId).toBe('ch_abc');
      expect(result.amount).toBe(2500);
      expect(result.currency).toBe('USD');
      expect(result.paymentMethod.last4).toBe('4242');
      expect(result.paymentMethod.expiryMonth).toBe(12);
      expect(result.paymentMethod.expiryYear).toBe(2030);
      expect(result.routing.source).toBe('local');
      expect(result.createdAt).toBeTruthy();
      expect(result.providerMetadata).toHaveProperty(
        'stripeStatus',
        'succeeded',
      );
    });

    it('sends capture_method=automatic for charge', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('capture_method=automatic');
    });

    it('includes description when provided', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
        description: 'Order #42',
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('description=');
    });

    it('includes customer email as receipt_email', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
        customer: { email: 'user@example.com' },
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('receipt_email=');
    });

    it('sends raw card data in payment_method_data', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_RAW,
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('payment_method_data');
    });

    it('sends token as payment_method when using card token', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('payment_method=pm_card_visa');
    });

    it('handles wallet payment method type', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: {
          type: 'wallet',
          walletType: 'apple_pay',
          token: 'tok_apple',
        },
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('apple_pay');
    });

    it('handles bank_transfer payment method type', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: {
          type: 'bank_transfer',
          bankCode: 'BOFAUS3N',
          accountNumber: '123456',
        },
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('customer_balance');
    });

    it('maps requires_capture status to authorized', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'requires_capture' })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.status).toBe('authorized');
    });

    it('maps requires_action status', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'requires_action' })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.status).toBe('requires_action');
    });

    it('maps processing status to pending', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'processing' })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.status).toBe('pending');
    });

    it('maps canceled status to cancelled', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'canceled' })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.status).toBe('cancelled');
    });

    it('maps requires_payment_method status to declined', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'requires_payment_method' })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.status).toBe('declined');
    });

    it('maps unknown status to failed', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'some_unknown_status' })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.status).toBe('failed');
    });

    it('throws on HTTP 402 card_declined error', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
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

      await expect(
        adapter.charge({
          amount: 100,
          currency: 'USD',
          paymentMethod: CARD_TOKEN,
        }),
      ).rejects.toMatchObject({
        hint: expect.objectContaining({
          providerCode: 'card_declined',
          declineCode: 'insufficient_funds',
        }),
      });
    });

    it('throws on HTTP 429 rate limit error', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'rate_limit',
              message: 'Too many requests.',
              type: 'invalid_request_error',
            },
          },
          429,
        ),
      );

      await expect(
        adapter.charge({
          amount: 100,
          currency: 'USD',
          paymentMethod: CARD_TOKEN,
        }),
      ).rejects.toMatchObject({
        status: 429,
      });
    });

    it('throws on HTTP 500 provider error', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          { error: { message: 'Internal server error', type: 'api_error' } },
          500,
        ),
      );

      await expect(
        adapter.charge({
          amount: 100,
          currency: 'USD',
          paymentMethod: CARD_TOKEN,
        }),
      ).rejects.toBeDefined();
    });

    it('throws on network error (fetch rejects)', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        adapter.charge({
          amount: 100,
          currency: 'USD',
          paymentMethod: CARD_TOKEN,
        }),
      ).rejects.toBeDefined();
    });

    it('propagates metadata into the result', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ metadata: { order_id: 'ord_999' } })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
        metadata: { internal: 'value' },
      });

      expect(result.metadata).toMatchObject({
        internal: 'value',
        order_id: 'ord_999',
      });
    });

    it('falls back to intent id when latest_charge is missing', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ latest_charge: undefined })),
      );

      const result = await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.providerId).toBe('pi_123');
    });

    it('sends confirm=true', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.charge({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('confirm=true');
    });
  });

  // -------------------------------------------------------------------------
  // authorize()
  // -------------------------------------------------------------------------

  describe('authorize()', () => {
    it('normalizes a successful authorize response', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'requires_capture' })),
      );

      const result = await adapter.authorize({
        amount: 2500,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      expect(result.id).toBe('pi_123');
      expect(result.status).toBe('authorized');
      expect(result.provider).toBe('stripe');
    });

    it('sends capture_method=manual for authorize', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'requires_capture' })),
      );

      await adapter.authorize({
        amount: 100,
        currency: 'USD',
        paymentMethod: CARD_TOKEN,
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('capture_method=manual');
    });

    it('throws on authorize failure', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'card_declined',
              message: 'Declined',
              type: 'card_error',
            },
          },
          402,
        ),
      );

      await expect(
        adapter.authorize({
          amount: 100,
          currency: 'USD',
          paymentMethod: CARD_TOKEN,
        }),
      ).rejects.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // capture()
  // -------------------------------------------------------------------------

  describe('capture()', () => {
    it('captures a full amount', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'succeeded' })),
      );

      const result = await adapter.capture({
        transactionId: 'pi_123',
      });

      expect(result.status).toBe('completed');
      const url = fetchFn.mock.calls[0]?.[0] as string;
      expect(url).toContain('/v1/payment_intents/pi_123/capture');
    });

    it('captures a partial amount', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'succeeded', amount: 1000 })),
      );

      const result = await adapter.capture({
        transactionId: 'pi_123',
        amount: 1000,
      });

      expect(result.status).toBe('completed');
      expect(result.amount).toBe(1000);
      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('amount_to_capture=1000');
    });

    it('throws when capturing an already-captured intent', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'payment_intent_unexpected_state',
              message:
                "This PaymentIntent's status is succeeded. You can only capture a payment intent with status requires_capture.",
              type: 'invalid_request_error',
            },
          },
          400,
        ),
      );

      await expect(
        adapter.capture({ transactionId: 'pi_123' }),
      ).rejects.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // refund()
  // -------------------------------------------------------------------------

  describe('refund()', () => {
    it('processes a full refund', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse({
          id: 're_123',
          payment_intent: 'pi_123',
          charge: 'ch_abc',
          status: 'succeeded',
          amount: 2500,
          currency: 'usd',
          created: 1_777_777_777,
        }),
      );

      const result = await adapter.refund({ transactionId: 'pi_123' });

      expect(result.id).toBe('re_123');
      expect(result.transactionId).toBe('pi_123');
      expect(result.status).toBe('completed');
      expect(result.amount).toBe(2500);
      expect(result.currency).toBe('USD');
      expect(result.provider).toBe('stripe');
      expect(result.providerId).toBe('ch_abc');
    });

    it('processes a partial refund', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse({
          id: 're_456',
          payment_intent: 'pi_123',
          status: 'succeeded',
          amount: 500,
          currency: 'usd',
          created: 1_777_777_777,
        }),
      );

      const result = await adapter.refund({
        transactionId: 'pi_123',
        amount: 500,
      });

      expect(result.amount).toBe(500);
      expect(result.status).toBe('completed');
    });

    it('includes reason in refund body', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse({
          id: 're_789',
          payment_intent: 'pi_123',
          status: 'succeeded',
          amount: 2500,
          currency: 'usd',
          reason: 'duplicate',
          created: 1_777_777_777,
        }),
      );

      const result = await adapter.refund({
        transactionId: 'pi_123',
        reason: 'duplicate',
      });

      const body = String(
        (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body,
      );
      expect(body).toContain('reason=duplicate');
      expect(result.reason).toBe('duplicate');
    });

    it('maps pending refund status', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse({
          id: 're_pend',
          payment_intent: 'pi_123',
          status: 'pending',
          amount: 2500,
          currency: 'usd',
          created: 1_777_777_777,
        }),
      );

      const result = await adapter.refund({ transactionId: 'pi_123' });

      expect(result.status).toBe('pending');
    });

    it('maps failed refund status', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse({
          id: 're_fail',
          payment_intent: 'pi_123',
          status: 'failed',
          amount: 2500,
          currency: 'usd',
          created: 1_777_777_777,
        }),
      );

      const result = await adapter.refund({ transactionId: 'pi_123' });

      expect(result.status).toBe('failed');
    });

    it('throws on already-refunded payment', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'charge_already_refunded',
              message: 'Charge has already been refunded.',
              type: 'invalid_request_error',
            },
          },
          400,
        ),
      );

      await expect(
        adapter.refund({ transactionId: 'pi_123' }),
      ).rejects.toBeDefined();
    });

    it('uses refund id as providerId when charge is missing', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse({
          id: 're_solo',
          payment_intent: 'pi_123',
          status: 'succeeded',
          amount: 100,
          currency: 'usd',
          created: 1_777_777_777,
        }),
      );

      const result = await adapter.refund({ transactionId: 'pi_123' });

      expect(result.providerId).toBe('re_solo');
    });
  });

  // -------------------------------------------------------------------------
  // void()
  // -------------------------------------------------------------------------

  describe('void()', () => {
    it('voids a payment intent successfully', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'canceled', id: 'pi_void' })),
      );

      const result = await adapter.void({ transactionId: 'pi_void' });

      expect(result.id).toBe('void_pi_void');
      expect(result.transactionId).toBe('pi_void');
      expect(result.status).toBe('completed');
      expect(result.provider).toBe('stripe');
      const url = fetchFn.mock.calls[0]?.[0] as string;
      expect(url).toContain('/v1/payment_intents/pi_void/cancel');
    });

    it('reports failed status when intent is not canceled', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ status: 'succeeded', id: 'pi_x' })),
      );

      const result = await adapter.void({ transactionId: 'pi_x' });

      expect(result.status).toBe('failed');
    });

    it('throws on void of already-voided intent (API error)', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'payment_intent_unexpected_state',
              message: 'Already canceled.',
              type: 'invalid_request_error',
            },
          },
          400,
        ),
      );

      await expect(
        adapter.void({ transactionId: 'pi_123' }),
      ).rejects.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // getStatus()
  // -------------------------------------------------------------------------

  describe('getStatus()', () => {
    it('retrieves transaction status', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      const result = await adapter.getStatus('pi_123');

      expect(result.id).toBe('pi_123');
      expect(result.status).toBe('completed');
      expect(result.provider).toBe('stripe');
      expect(result.providerId).toBe('ch_abc');
      expect(result.amount).toBe(2500);
      expect(result.currency).toBe('USD');
      expect(result.history).toHaveLength(1);
      expect(result.history[0].status).toBe('completed');
      expect(result.history[0].reason).toContain('stripe status');
      expect(result.updatedAt).toBeTruthy();
    });

    it('sends a GET request', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(stripeIntent()));

      await adapter.getStatus('pi_123');

      const requestInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(requestInit?.method).toBe('GET');
    });

    it('throws when payment intent is not found (404)', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'resource_missing',
              message: "No such payment_intent: 'pi_nonexistent'",
              type: 'invalid_request_error',
            },
          },
          404,
        ),
      );

      await expect(adapter.getStatus('pi_nonexistent')).rejects.toBeDefined();
    });

    it('falls back to id when latest_charge is missing', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(stripeIntent({ latest_charge: undefined })),
      );

      const result = await adapter.getStatus('pi_123');

      expect(result.providerId).toBe('pi_123');
    });
  });

  // -------------------------------------------------------------------------
  // listPaymentMethods()
  // -------------------------------------------------------------------------

  describe('listPaymentMethods()', () => {
    it('returns card and wallet methods', async () => {
      const { adapter } = makeAdapter();
      const methods = await adapter.listPaymentMethods('US', 'usd');

      expect(methods).toHaveLength(2);
      expect(methods[0].type).toBe('card');
      expect(methods[0].provider).toBe('stripe');
      expect(methods[0].name).toBe('Stripe Card');
      expect(methods[0].countries).toContain('US');
      expect(methods[0].currencies).toContain('USD');
      expect(methods[1].type).toBe('wallet');
    });

    it('normalizes currency to uppercase', async () => {
      const { adapter } = makeAdapter();
      const methods = await adapter.listPaymentMethods('GB', 'gbp');

      expect(methods[0].currencies).toContain('GBP');
      expect(methods[1].currencies).toContain('GBP');
    });

    it('passes through country parameter', async () => {
      const { adapter } = makeAdapter();
      const methods = await adapter.listPaymentMethods('DE', 'EUR');

      expect(methods[0].countries).toContain('DE');
    });
  });

  // -------------------------------------------------------------------------
  // handleWebhook()
  // -------------------------------------------------------------------------

  describe('handleWebhook()', () => {
    const WEBHOOK_SECRET = 'whsec_test_secret';

    function signedWebhook(
      event: Record<string, unknown>,
      secret = WEBHOOK_SECRET,
    ) {
      return createStripeSignedWebhookPayload(event, secret);
    }

    it('verifies and normalizes a payment_intent.succeeded event', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        created: 1_777_777_777,
        data: { object: { id: 'pi_123' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.completed');
      expect(event.transactionId).toBe('pi_123');
      expect(event.provider).toBe('stripe');
      expect(event.providerEventId).toBe('evt_1');
    });

    it('maps payment_intent.payment_failed to payment.failed', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_2',
        type: 'payment_intent.payment_failed',
        created: 1_777_777_777,
        data: { object: { id: 'pi_456' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.failed');
    });

    it('maps payment_intent.processing to payment.pending', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_3',
        type: 'payment_intent.processing',
        created: 1_777_777_777,
        data: { object: { id: 'pi_789' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.pending');
    });

    it('maps payment_intent.requires_action', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_4',
        type: 'payment_intent.requires_action',
        created: 1_777_777_777,
        data: { object: { id: 'pi_act' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.requires_action');
    });

    it('maps charge.refunded to payment.refunded', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_5',
        type: 'charge.refunded',
        created: 1_777_777_777,
        data: { object: { payment_intent: 'pi_ref' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.refunded');
      expect(event.transactionId).toBe('pi_ref');
    });

    it('maps charge.dispute.created to payment.disputed', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_6',
        type: 'charge.dispute.created',
        created: 1_777_777_777,
        data: { object: { charge: 'ch_disp' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.disputed');
    });

    it('maps charge.dispute.closed to payment.dispute_resolved', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_7',
        type: 'charge.dispute.closed',
        created: 1_777_777_777,
        data: { object: { id: 'dp_closed' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.dispute_resolved');
    });

    it('maps payout.paid to payout.completed', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_8',
        type: 'payout.paid',
        created: 1_777_777_777,
        data: { object: { id: 'po_123' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payout.completed');
    });

    it('maps payout.failed to payout.failed', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_9',
        type: 'payout.failed',
        created: 1_777_777_777,
        data: { object: { id: 'po_456' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payout.failed');
    });

    it('maps unknown event type to payment.failed', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_unk',
        type: 'some.unknown.event',
        created: 1_777_777_777,
        data: { object: { id: 'x' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.type).toBe('payment.failed');
    });

    it('throws WebhookVerificationError for invalid signature', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });

      await expect(
        adapter.handleWebhook('{"id":"evt_1"}', {
          'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`,
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws when webhook secret is not configured', async () => {
      const { adapter } = makeAdapter();

      await expect(
        adapter.handleWebhook('{"id":"evt_1"}', {
          'stripe-signature': 't=123,v1=abc',
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws when signature header is missing', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });

      await expect(
        adapter.handleWebhook('{"id":"evt_1"}', {}),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws when signature header is malformed (no v1)', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });

      await expect(
        adapter.handleWebhook('{"id":"evt_1"}', {
          'stripe-signature': 't=12345',
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws when signature header is malformed (no timestamp)', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });

      await expect(
        adapter.handleWebhook('{"id":"evt_1"}', {
          'stripe-signature': 'v1=abcdef',
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws when timestamp is not a valid number', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });

      await expect(
        adapter.handleWebhook('{"id":"evt_1"}', {
          'stripe-signature': 't=notanumber,v1=abcdef',
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws when timestamp is too old (replay attack)', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
      const payloadStr = '{"id":"evt_old"}';
      const sig = createHmac('sha256', WEBHOOK_SECRET)
        .update(`${oldTimestamp}.${payloadStr}`)
        .digest('hex');

      await expect(
        adapter.handleWebhook(payloadStr, {
          'stripe-signature': `t=${oldTimestamp},v1=${sig}`,
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws for invalid JSON payload', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const payloadStr = 'not valid json {{{';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', WEBHOOK_SECRET)
        .update(`${timestamp}.${payloadStr}`)
        .digest('hex');

      await expect(
        adapter.handleWebhook(payloadStr, {
          'stripe-signature': `t=${timestamp},v1=${sig}`,
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('accepts Buffer payload', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const payloadObj = {
        id: 'evt_buf',
        type: 'payment_intent.succeeded',
        created: 1_777_777_777,
        data: { object: { id: 'pi_buf' } },
      };
      const payloadStr = JSON.stringify(payloadObj);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', WEBHOOK_SECRET)
        .update(`${timestamp}.${payloadStr}`)
        .digest('hex');

      const event = await adapter.handleWebhook(
        Buffer.from(payloadStr, 'utf-8'),
        { 'stripe-signature': `t=${timestamp},v1=${sig}` },
      );

      expect(event.type).toBe('payment.completed');
    });

    it('extracts transactionId from payment_intent field in object', async () => {
      const { adapter } = makeAdapter({ webhookSecret: WEBHOOK_SECRET });
      const { payload, headers } = signedWebhook({
        id: 'evt_charge',
        type: 'charge.refunded',
        created: 1_777_777_777,
        data: { object: { payment_intent: 'pi_from_charge' } },
      });

      const event = await adapter.handleWebhook(payload, headers);

      expect(event.transactionId).toBe('pi_from_charge');
    });
  });

  // -------------------------------------------------------------------------
  // Error classification through VaultClient
  // -------------------------------------------------------------------------

  describe('error classification through VaultClient', () => {
    function makeClient(fetchFn: typeof fetch) {
      return new VaultClient({
        providers: {
          stripe: {
            adapter: StripeAdapter,
            config: { apiKey: 'sk_test_123', fetchFn },
          },
        },
        routing: {
          rules: [{ match: { default: true }, provider: 'stripe' }],
        },
      });
    }

    const chargeRequest = {
      amount: 2500,
      currency: 'USD',
      paymentMethod: CARD_TOKEN,
      customer: { email: 'test@example.com' },
    };

    it('maps card_declined to CARD_DECLINED', async () => {
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

      const client = makeClient(fetchFn as typeof fetch);

      await expect(client.charge(chargeRequest)).rejects.toMatchObject({
        code: 'CARD_DECLINED',
        category: 'card_declined',
        context: {
          provider: 'stripe',
          operation: 'charge',
        },
      });
    });

    it('maps fraud error to FRAUD_SUSPECTED', async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'card_declined',
              message: 'Your card was declined due to suspected fraud.',
              type: 'card_error',
            },
          },
          402,
        ),
      );

      const client = makeClient(fetchFn as typeof fetch);

      await expect(client.charge(chargeRequest)).rejects.toMatchObject({
        code: 'FRAUD_SUSPECTED',
      });
    });

    it('maps rate_limit to RATE_LIMITED', async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'rate_limit',
              message: 'Too many requests.',
              type: 'invalid_request_error',
            },
          },
          429,
        ),
      );

      const client = makeClient(fetchFn as typeof fetch);

      await expect(client.charge(chargeRequest)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
    });

    it('maps authentication required to AUTHENTICATION_REQUIRED', async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'authentication_required',
              message: '3DS authentication is required.',
              type: 'card_error',
            },
          },
          402,
        ),
      );

      const client = makeClient(fetchFn as typeof fetch);

      await expect(client.charge(chargeRequest)).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
    });

    it('maps 401 unauthorized to PROVIDER_AUTH_FAILED', async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse(
          {
            error: {
              code: 'invalid_api_key',
              message: 'Invalid API Key provided.',
              type: 'authentication_error',
            },
          },
          401,
        ),
      );

      const client = makeClient(fetchFn as typeof fetch);

      await expect(client.charge(chargeRequest)).rejects.toMatchObject({
        code: 'PROVIDER_AUTH_FAILED',
      });
    });

    it('maps 500 server error to PROVIDER_ERROR', async () => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        createJsonResponse(
          {
            error: {
              message: 'Internal server error.',
              type: 'api_error',
            },
          },
          500,
        ),
      );

      const client = makeClient(fetchFn as typeof fetch);

      await expect(client.charge(chargeRequest)).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
      });
    });

    it('maps network error to NETWORK_ERROR', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const client = makeClient(fetchFn as typeof fetch);

      await expect(client.charge(chargeRequest)).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      });
    });
  });
});
