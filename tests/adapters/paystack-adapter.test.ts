import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PaystackAdapter } from '../../src/adapters';
import { VaultClient } from '../../src/client';
import {
  VaultConfigError,
  VaultNetworkError,
  VaultProviderError,
  WebhookVerificationError,
} from '../../src/errors';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'request-id': 'req_paystack_test',
    },
  });
}

function paystackEnvelope<T>(data: T, message = 'ok') {
  return {
    status: true,
    message,
    data,
  };
}

function makeAdapter(overrides: Record<string, unknown> = {}): {
  adapter: PaystackAdapter;
  fetchFn: ReturnType<typeof vi.fn>;
} {
  const fetchFn = vi.fn<typeof fetch>();
  const adapter = new PaystackAdapter({
    secretKey: 'sk_test_123',
    fetchFn,
    ...overrides,
  });
  return { adapter, fetchFn };
}

function paystackTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    reference: 'ref_123',
    status: 'success',
    amount: 2500,
    currency: 'NGN',
    paid_at: '2026-03-02T00:00:00.000Z',
    authorization: {
      authorization_code: 'AUTH_123',
      last4: '4081',
      brand: 'visa',
      exp_month: '12',
      exp_year: '2030',
    },
    customer: {
      email: 'customer@example.com',
    },
    ...overrides,
  };
}

function createClient(fetchFn: typeof fetch): VaultClient {
  return new VaultClient({
    providers: {
      paystack: {
        adapter: PaystackAdapter,
        config: {
          secretKey: 'sk_test_123',
          fetchFn,
        },
      },
    },
    routing: {
      rules: [{ match: { default: true }, provider: 'paystack' }],
    },
  });
}

describe('PaystackAdapter', () => {
  describe('constructor and metadata', () => {
    it('throws VaultConfigError when secretKey is missing', () => {
      expect(() => new PaystackAdapter({ secretKey: '   ' })).toThrow(
        VaultConfigError,
      );
    });

    it('declares static and instance metadata capabilities', () => {
      const { adapter } = makeAdapter();

      expect(PaystackAdapter.supportedMethods).toContain('card');
      expect(PaystackAdapter.supportedCurrencies).toContain('NGN');
      expect(PaystackAdapter.supportedCountries).toContain('NG');
      expect(adapter.metadata.supportedMethods).toContain('wallet');
    });

    it('uses custom baseUrl when provided', async () => {
      const { adapter, fetchFn } = makeAdapter({
        baseUrl: 'https://sandbox.paystack.test',
      });
      fetchFn.mockResolvedValue(
        createJsonResponse(paystackEnvelope(paystackTransaction())),
      );

      await adapter.charge({
        amount: 2500,
        currency: 'NGN',
        paymentMethod: {
          type: 'card',
          token: 'AUTH_123',
        },
        customer: {
          email: 'customer@example.com',
        },
      });

      expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
        'https://sandbox.paystack.test',
      );
    });
  });

  describe('charge and authorize', () => {
    it('normalizes charge responses', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(paystackEnvelope(paystackTransaction())),
      );

      const result = await adapter.charge({
        amount: 2500,
        currency: 'NGN',
        paymentMethod: {
          type: 'card',
          token: 'AUTH_123',
        },
        customer: {
          email: 'customer@example.com',
        },
      });

      const body = JSON.parse(
        String((fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(body.metadata.vaultsaas_intent).toBe('charge');
      expect(result.id).toBe('ref_123');
      expect(result.provider).toBe('paystack');
      expect(result.status).toBe('completed');
      expect(result.currency).toBe('NGN');
      expect(result.paymentMethod.last4).toBe('4081');
    });

    it('requires customer email for charge', async () => {
      const { adapter } = makeAdapter();

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

    it('sets authorize metadata intent', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(paystackEnvelope(paystackTransaction())),
      );

      await adapter.authorize({
        amount: 2500,
        currency: 'NGN',
        paymentMethod: {
          type: 'card',
          token: 'AUTH_123',
        },
        customer: {
          email: 'customer@example.com',
        },
      });

      const body = JSON.parse(
        String((fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(body.metadata.vaultsaas_intent).toBe('authorize');
    });

    it('maps pending and cancelled payment statuses', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn
        .mockResolvedValueOnce(
          createJsonResponse(
            paystackEnvelope(paystackTransaction({ status: 'pending' })),
          ),
        )
        .mockResolvedValueOnce(
          createJsonResponse(
            paystackEnvelope(paystackTransaction({ status: 'abandoned' })),
          ),
        );

      const pending = await adapter.charge({
        amount: 2500,
        currency: 'NGN',
        paymentMethod: {
          type: 'card',
          token: 'AUTH_123',
        },
        customer: {
          email: 'customer@example.com',
        },
      });
      const cancelled = await adapter.charge({
        amount: 2500,
        currency: 'NGN',
        paymentMethod: {
          type: 'card',
          token: 'AUTH_123',
        },
        customer: {
          email: 'customer@example.com',
        },
      });

      expect(pending.status).toBe('pending');
      expect(cancelled.status).toBe('cancelled');
    });
  });

  describe('capture and refund', () => {
    it('captures full amount by verifying then charging authorization', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn
        .mockResolvedValueOnce(
          createJsonResponse(paystackEnvelope(paystackTransaction())),
        )
        .mockResolvedValueOnce(
          createJsonResponse(paystackEnvelope(paystackTransaction())),
        );

      const result = await adapter.capture({ transactionId: 'ref_123' });

      expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
        '/transaction/verify/ref_123',
      );
      expect(String(fetchFn.mock.calls[1]?.[0])).toContain(
        '/transaction/charge_authorization',
      );

      const chargeBody = JSON.parse(
        String((fetchFn.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
      );
      expect(chargeBody.amount).toBe(2500);
      expect(result.status).toBe('completed');
    });

    it('captures partial amount', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn
        .mockResolvedValueOnce(
          createJsonResponse(paystackEnvelope(paystackTransaction())),
        )
        .mockResolvedValueOnce(
          createJsonResponse(
            paystackEnvelope(
              paystackTransaction({ amount: 500, reference: 'ref_500' }),
            ),
          ),
        );

      const result = await adapter.capture({
        transactionId: 'ref_123',
        amount: 500,
      });

      const chargeBody = JSON.parse(
        String((fetchFn.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
      );
      expect(chargeBody.amount).toBe(500);
      expect(result.amount).toBe(500);
      expect(result.id).toBe('ref_500');
    });

    it('throws when capture verification lacks authorization code or email', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          paystackEnvelope(
            paystackTransaction({
              authorization: {},
              customer: {},
            }),
          ),
        ),
      );

      await expect(
        adapter.capture({ transactionId: 'ref_123' }),
      ).rejects.toBeInstanceOf(VaultProviderError);
    });

    it('processes full and partial refunds', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn
        .mockResolvedValueOnce(
          createJsonResponse(
            paystackEnvelope({
              id: 11,
              transaction: 123,
              status: 'processed',
              amount: 2500,
              currency: 'NGN',
              created_at: '2026-03-02T00:00:00.000Z',
            }),
          ),
        )
        .mockResolvedValueOnce(
          createJsonResponse(
            paystackEnvelope({
              id: 12,
              transaction: 123,
              status: 'pending',
              amount: 500,
              currency: 'NGN',
              created_at: '2026-03-02T00:00:00.000Z',
            }),
          ),
        );

      const full = await adapter.refund({ transactionId: 'ref_123' });
      const partial = await adapter.refund({
        transactionId: 'ref_123',
        amount: 500,
      });

      expect(full.status).toBe('completed');
      expect(partial.status).toBe('pending');
      expect(partial.amount).toBe(500);
    });
  });

  describe('void, status, and methods', () => {
    it('returns completed void status when refund succeeds', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          paystackEnvelope({
            id: 11,
            transaction: 123,
            status: 'processed',
            amount: 2500,
            currency: 'NGN',
            created_at: '2026-03-02T00:00:00.000Z',
          }),
        ),
      );

      const result = await adapter.void({ transactionId: 'ref_123' });

      expect(result.status).toBe('completed');
      expect(result.id).toContain('void_');
    });

    it('returns failed void status when refund is pending', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          paystackEnvelope({
            id: 12,
            transaction: 123,
            status: 'pending',
            amount: 2500,
            currency: 'NGN',
            created_at: '2026-03-02T00:00:00.000Z',
          }),
        ),
      );

      const result = await adapter.void({ transactionId: 'ref_123' });

      expect(result.status).toBe('failed');
    });

    it('normalizes getStatus response', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          paystackEnvelope(
            paystackTransaction({
              status: 'queued',
              gateway_response: 'queued by provider',
            }),
          ),
        ),
      );

      const status = await adapter.getStatus('ref_123');

      expect(status.status).toBe('pending');
      expect(status.history[0]?.reason).toBe('queued by provider');
    });

    it('returns available payment methods', async () => {
      const { adapter } = makeAdapter();

      const methods = await adapter.listPaymentMethods('NG', 'ngn');

      expect(methods.map((method) => method.type)).toEqual([
        'card',
        'bank_transfer',
      ]);
      expect(methods[0]?.currencies).toEqual(['NGN']);
    });
  });

  describe('webhooks', () => {
    it('verifies and normalizes Paystack webhooks', async () => {
      const secret = 'whsec_123';
      const { adapter } = makeAdapter({ webhookSecret: secret });

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
      expect(event.providerEventId).toBe('ref_123');
    });

    it('throws for missing Paystack webhook signature', async () => {
      const { adapter } = makeAdapter();

      await expect(
        adapter.handleWebhook('{"event":"charge.success"}', {}),
      ).rejects.toThrow('Missing Paystack signature header.');
    });

    it('throws for invalid Paystack webhook signature', async () => {
      const { adapter } = makeAdapter();

      await expect(
        adapter.handleWebhook('{"event":"charge.success"}', {
          'x-paystack-signature': 'deadbeef',
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws for invalid JSON payload after signature verification', async () => {
      const secret = 'whsec_123';
      const { adapter } = makeAdapter({ webhookSecret: secret });
      const payload = '{"event":"charge.success"';
      const signature = createHmac('sha512', secret)
        .update(payload)
        .digest('hex');

      await expect(
        adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        }),
      ).rejects.toThrow('Paystack webhook payload is not valid JSON.');
    });

    describe('event type mapping', () => {
      it('maps Paystack "charge.success" to "payment.completed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'charge.success',
          data: {
            id: 123,
            reference: 'ref_cs',
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
      });

      it('maps Paystack "charge.failed" to "payment.failed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'charge.failed',
          data: {
            id: 123,
            reference: 'ref_cf',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.failed');
      });

      it('maps Paystack "charge.pending" to "payment.pending"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'charge.pending',
          data: {
            id: 123,
            reference: 'ref_cp',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.pending');
      });

      it('maps Paystack "refund.processed" to "payment.refunded"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'refund.processed',
          data: {
            id: 123,
            reference: 'ref_rp',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.refunded');
      });

      it('maps Paystack "refund.success" to "payment.refunded"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'refund.success',
          data: {
            id: 123,
            reference: 'ref_rs',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.refunded');
      });

      it('maps Paystack "refund.pending" to "payment.partially_refunded"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'refund.pending',
          data: {
            id: 123,
            reference: 'ref_rpend',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.partially_refunded');
      });

      it('maps Paystack "dispute.create" to "payment.disputed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'dispute.create',
          data: {
            id: 123,
            reference: 'ref_dc',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.disputed');
      });

      it('maps Paystack "dispute.resolve" to "payment.dispute_resolved"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'dispute.resolve',
          data: {
            id: 123,
            reference: 'ref_dr',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.dispute_resolved');
      });

      it('maps Paystack "transfer.success" to "payout.completed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'transfer.success',
          data: {
            id: 123,
            reference: 'ref_ts',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payout.completed');
      });

      it('maps Paystack "transfer.failed" to "payout.failed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'transfer.failed',
          data: {
            id: 123,
            reference: 'ref_tf',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payout.failed');
      });

      it('maps unknown Paystack event type to "payment.failed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          event: 'some.unknown.event',
          data: {
            id: 123,
            reference: 'ref_unknown',
            created_at: '2026-03-02T00:00:00.000Z',
          },
        });
        const signature = createHmac('sha512', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-paystack-signature': signature,
        });

        expect(event.type).toBe('payment.failed');
      });
    });

    it('accepts Buffer payload and normalizes correctly', async () => {
      const secret = 'whsec_123';
      const { adapter } = makeAdapter({ webhookSecret: secret });
      const payloadStr = JSON.stringify({
        event: 'charge.success',
        data: {
          id: 456,
          reference: 'ref_buf',
          created_at: '2026-03-02T00:00:00.000Z',
        },
      });
      const signature = createHmac('sha512', secret)
        .update(payloadStr)
        .digest('hex');

      const event = await adapter.handleWebhook(Buffer.from(payloadStr), {
        'x-paystack-signature': signature,
      });

      expect(event.type).toBe('payment.completed');
      expect(event.transactionId).toBe('ref_buf');
    });
  });

  describe('error classification through VaultClient', () => {
    it('maps HTTP 401 errors to PROVIDER_AUTH_FAILED', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createJsonResponse({ message: 'Unauthorized' }, 401),
        );
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 2500,
          currency: 'NGN',
          paymentMethod: { type: 'card', token: 'AUTH_123' },
          customer: { email: 'customer@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_AUTH_FAILED',
        category: 'configuration_error',
      });
    });

    it('maps HTTP 429 errors to RATE_LIMITED', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createJsonResponse({ message: 'Too many requests' }, 429),
        );
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 2500,
          currency: 'NGN',
          paymentMethod: { type: 'card', token: 'AUTH_123' },
          customer: { email: 'customer@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        category: 'rate_limited',
      });
    });

    it('maps network failures to VaultNetworkError', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('socket hang up'));
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 2500,
          currency: 'NGN',
          paymentMethod: { type: 'card', token: 'AUTH_123' },
          customer: { email: 'customer@example.com' },
        }),
      ).rejects.toBeInstanceOf(VaultNetworkError);
    });

    it('maps HTTP 402 card_declined to CARD_DECLINED', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createJsonResponse({ message: 'card_declined' }, 402),
        );
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 2500,
          currency: 'NGN',
          paymentMethod: { type: 'card', token: 'AUTH_123' },
          customer: { email: 'customer@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'CARD_DECLINED',
      });
    });

    it('maps HTTP 400 fraud to FRAUD_SUSPECTED', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonResponse({ message: 'fraud' }, 400));
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 2500,
          currency: 'NGN',
          paymentMethod: { type: 'card', token: 'AUTH_123' },
          customer: { email: 'customer@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'FRAUD_SUSPECTED',
      });
    });

    it('maps HTTP 400 authentication_required to AUTHENTICATION_REQUIRED', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createJsonResponse({ message: 'authentication_required' }, 400),
        );
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 2500,
          currency: 'NGN',
          paymentMethod: { type: 'card', token: 'AUTH_123' },
          customer: { email: 'customer@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'AUTHENTICATION_REQUIRED',
      });
    });

    it('maps HTTP 500 server error to PROVIDER_ERROR', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createJsonResponse({ message: 'Internal Server Error' }, 500),
        );
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 2500,
          currency: 'NGN',
          paymentMethod: { type: 'card', token: 'AUTH_123' },
          customer: { email: 'customer@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
      });
    });
  });
});
