import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DLocalAdapter } from '../../src/adapters';
import { VaultClient } from '../../src/client';
import {
  VaultConfigError,
  VaultNetworkError,
  WebhookVerificationError,
} from '../../src/errors';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'request-id': 'req_dlocal_test',
    },
  });
}

function makeAdapter(overrides: Record<string, unknown> = {}): {
  adapter: DLocalAdapter;
  fetchFn: ReturnType<typeof vi.fn>;
} {
  const fetchFn = vi.fn<typeof fetch>();
  const adapter = new DLocalAdapter({
    xLogin: 'login_123',
    xTransKey: 'trans_123',
    secretKey: 'secret_123',
    fetchFn,
    ...overrides,
  });

  return { adapter, fetchFn };
}

function dlocalPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dl_123',
    payment_id: 'pay_123',
    status: 'APPROVED',
    amount: 1500,
    currency: 'BRL',
    payment_method_id: 'PIX',
    created_date: '2026-03-02T00:00:00.000Z',
    ...overrides,
  };
}

function createClient(fetchFn: typeof fetch): VaultClient {
  return new VaultClient({
    providers: {
      dlocal: {
        adapter: DLocalAdapter,
        config: {
          xLogin: 'login_123',
          xTransKey: 'trans_123',
          secretKey: 'secret_123',
          fetchFn,
        },
      },
    },
    routing: {
      rules: [{ match: { default: true }, provider: 'dlocal' }],
    },
  });
}

describe('DLocalAdapter', () => {
  describe('constructor and metadata', () => {
    it('throws VaultConfigError when required credentials are missing', () => {
      expect(
        () =>
          new DLocalAdapter({
            xLogin: 'login',
            xTransKey: '',
            secretKey: 'secret',
          }),
      ).toThrow(VaultConfigError);
    });

    it('declares static and instance metadata capabilities', () => {
      const { adapter } = makeAdapter();

      expect(DLocalAdapter.supportedMethods).toContain('pix');
      expect(DLocalAdapter.supportedCurrencies).toContain('BRL');
      expect(DLocalAdapter.supportedCountries).toContain('BR');
      expect(adapter.metadata.supportedMethods).toContain('card');
    });

    it('uses custom baseUrl when provided', async () => {
      const { adapter, fetchFn } = makeAdapter({
        baseUrl: 'https://sandbox.dlocal.test',
      });
      fetchFn.mockResolvedValue(createJsonResponse(dlocalPayment()));

      await adapter.charge({
        amount: 1500,
        currency: 'BRL',
        paymentMethod: { type: 'pix' },
      });

      expect(String(fetchFn.mock.calls[0]?.[0])).toContain(
        'https://sandbox.dlocal.test',
      );
    });
  });

  describe('charge and authorize', () => {
    it('normalizes a successful charge response and signs headers', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(
          dlocalPayment({
            card: { last4: '4242' },
            order_id: 'ord_1',
          }),
        ),
      );

      const result = await adapter.charge({
        amount: 1500,
        currency: 'BRL',
        paymentMethod: { type: 'pix' },
        customer: { email: 'buyer@example.com' },
        metadata: { orderId: 'ord_1' },
      });

      expect(result.id).toBe('pay_123');
      expect(result.status).toBe('completed');
      expect(result.provider).toBe('dlocal');
      expect(result.currency).toBe('BRL');
      expect(result.paymentMethod.type).toBe('pix');
      expect(result.providerMetadata.orderId).toBe('ord_1');

      const requestInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = requestInit?.headers as Record<string, string>;
      const body = JSON.parse(String(requestInit?.body));

      expect(headers['x-login']).toBe('login_123');
      expect(headers['x-trans-key']).toBe('trans_123');
      expect(headers.authorization).toContain('V2-HMAC-SHA256');
      expect(body.capture).toBe(true);
      expect(body.payment_method_id).toBe('PIX');
    });

    it('maps authorize to authorized status and capture=false payload', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(dlocalPayment({ status: 'AUTHORIZED' })),
      );

      const result = await adapter.authorize({
        amount: 1500,
        currency: 'BRL',
        paymentMethod: { type: 'card', token: 'tok_123' },
      });

      const body = JSON.parse(
        String((fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(body.capture).toBe(false);
      expect(body.payment_method_id).toBe('CARD');
      expect(result.status).toBe('authorized');
    });

    it('maps declined and requires_action statuses', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn
        .mockResolvedValueOnce(
          createJsonResponse(dlocalPayment({ status: 'DECLINED' })),
        )
        .mockResolvedValueOnce(
          createJsonResponse(dlocalPayment({ status: 'REQUIRES_ACTION' })),
        );

      const declined = await adapter.charge({
        amount: 100,
        currency: 'BRL',
        paymentMethod: { type: 'pix' },
      });
      const requiresAction = await adapter.charge({
        amount: 100,
        currency: 'BRL',
        paymentMethod: { type: 'pix' },
      });

      expect(declined.status).toBe('declined');
      expect(requiresAction.status).toBe('requires_action');
    });
  });

  describe('capture and refund', () => {
    it('captures a full amount when amount is omitted', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(createJsonResponse(dlocalPayment()));

      const result = await adapter.capture({ transactionId: 'pay_123' });

      const requestInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(String(fetchFn.mock.calls[0]?.[0])).toContain('/pay_123/capture');
      expect(requestInit?.body).toBeUndefined();
      expect(result.id).toBe('pay_123');
      expect(result.status).toBe('completed');
    });

    it('captures a partial amount', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(dlocalPayment({ amount: 500, status: 'CAPTURED' })),
      );

      const result = await adapter.capture({
        transactionId: 'pay_123',
        amount: 500,
      });

      const body = JSON.parse(
        String((fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      expect(body.amount).toBe(500);
      expect(result.amount).toBe(500);
      expect(result.status).toBe('completed');
    });

    it('processes full and partial refunds with reason', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn
        .mockResolvedValueOnce(
          createJsonResponse({
            id: 'dl_ref_1',
            refund_id: 'ref_1',
            payment_id: 'pay_123',
            status: 'APPROVED',
            amount: 1500,
            currency: 'BRL',
            reason: 'requested_by_customer',
            created_date: '2026-03-02T00:00:00.000Z',
          }),
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            id: 'dl_ref_2',
            refund_id: 'ref_2',
            payment_id: 'pay_123',
            status: 'PENDING',
            amount: 500,
            currency: 'BRL',
            created_date: '2026-03-02T00:00:00.000Z',
          }),
        );

      const fullRefund = await adapter.refund({
        transactionId: 'pay_123',
        reason: 'requested_by_customer',
      });
      const partialRefund = await adapter.refund({
        transactionId: 'pay_123',
        amount: 500,
      });

      const firstBody = JSON.parse(
        String((fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
      );
      const secondBody = JSON.parse(
        String((fetchFn.mock.calls[1]?.[1] as RequestInit | undefined)?.body),
      );

      expect(firstBody.reason).toBe('requested_by_customer');
      expect(secondBody.amount).toBe(500);
      expect(fullRefund.status).toBe('completed');
      expect(partialRefund.status).toBe('pending');
    });
  });

  describe('void, status, and methods', () => {
    it('returns completed void status when provider cancels payment', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(dlocalPayment({ status: 'CANCELED' })),
      );

      const result = await adapter.void({ transactionId: 'pay_123' });

      expect(result.status).toBe('completed');
      expect(result.transactionId).toBe('pay_123');
    });

    it('returns failed void status when provider does not cancel payment', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(dlocalPayment({ status: 'APPROVED' })),
      );

      const result = await adapter.void({ transactionId: 'pay_123' });

      expect(result.status).toBe('failed');
    });

    it('normalizes transaction status history', async () => {
      const { adapter, fetchFn } = makeAdapter();
      fetchFn.mockResolvedValue(
        createJsonResponse(dlocalPayment({ status: 'IN_PROCESS' })),
      );

      const status = await adapter.getStatus('pay_123');

      expect(status.status).toBe('pending');
      expect(status.history[0]?.reason).toContain('dlocal status');
    });

    it('returns available payment methods with uppercase currency', async () => {
      const { adapter } = makeAdapter();

      const methods = await adapter.listPaymentMethods('BR', 'brl');

      expect(methods).toHaveLength(3);
      expect(methods[0]?.currencies).toEqual(['BRL']);
      expect(methods.map((method) => method.type)).toEqual([
        'card',
        'pix',
        'boleto',
      ]);
    });
  });

  describe('webhooks', () => {
    it('verifies and normalizes dLocal webhooks', async () => {
      const secret = 'whsec_123';
      const { adapter } = makeAdapter({ webhookSecret: secret });
      const payload = JSON.stringify({
        id: 'evt_1',
        type: 'payment.approved',
        payment_id: 'pay_123',
      });
      const signature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const event = await adapter.handleWebhook(payload, {
        'x-dlocal-signature': signature,
      });

      expect(event.type).toBe('payment.completed');
      expect(event.transactionId).toBe('pay_123');
      expect(event.providerEventId).toBe('evt_1');
    });

    it('supports x-signature fallback header', async () => {
      const secret = 'whsec_123';
      const { adapter } = makeAdapter({ webhookSecret: secret });
      const payload = JSON.stringify({
        id: 'evt_2',
        event: 'payment.pending',
        data: { payment_id: 'pay_123' },
      });
      const signature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const event = await adapter.handleWebhook(payload, {
        'x-signature': signature,
      });

      expect(event.type).toBe('payment.pending');
      expect(event.transactionId).toBe('pay_123');
    });

    it('throws for missing signature header', async () => {
      const { adapter } = makeAdapter();

      await expect(adapter.handleWebhook('{"id":"evt_1"}', {})).rejects.toThrow(
        'Missing dLocal signature header.',
      );
    });

    it('throws for invalid dLocal webhook signature', async () => {
      const { adapter } = makeAdapter();

      await expect(
        adapter.handleWebhook('{"id":"evt_1"}', {
          'x-dlocal-signature': 'deadbeef',
        }),
      ).rejects.toBeInstanceOf(WebhookVerificationError);
    });

    it('throws for invalid JSON payload after signature verification', async () => {
      const secret = 'whsec_123';
      const { adapter } = makeAdapter({ webhookSecret: secret });
      const payload = '{"id":"evt_1"';
      const signature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      await expect(
        adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        }),
      ).rejects.toThrow('dLocal webhook payload is not valid JSON.');
    });

    describe('event type mapping', () => {
      it('maps dLocal "payment.approved" to "payment.completed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_approved',
          type: 'payment.approved',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.completed');
      });

      it('maps dLocal "payment.captured" to "payment.completed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_captured',
          type: 'payment.captured',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.completed');
      });

      it('maps dLocal "payment.pending" to "payment.pending"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_pending',
          type: 'payment.pending',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.pending');
      });

      it('maps dLocal "payment.failed" to "payment.failed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_failed',
          type: 'payment.failed',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.failed');
      });

      it('maps dLocal "payment.rejected" to "payment.failed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_rejected',
          type: 'payment.rejected',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.failed');
      });

      it('maps dLocal "payment.refunded" to "payment.refunded"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_refunded',
          type: 'payment.refunded',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.refunded');
      });

      it('maps dLocal "payment.partially_refunded" to "payment.partially_refunded"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_partial_refund',
          type: 'payment.partially_refunded',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.partially_refunded');
      });

      it('maps dLocal "chargeback.created" to "payment.disputed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_chargeback',
          type: 'chargeback.created',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.disputed');
      });

      it('maps dLocal "chargeback.closed" to "payment.dispute_resolved"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_chargeback_closed',
          type: 'chargeback.closed',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.dispute_resolved');
      });

      it('maps unknown dLocal event type to "payment.failed"', async () => {
        const secret = 'whsec_123';
        const { adapter } = makeAdapter({ webhookSecret: secret });
        const payload = JSON.stringify({
          id: 'evt_unknown',
          type: 'some.unknown.event',
          payment_id: 'pay_123',
        });
        const signature = createHmac('sha256', secret)
          .update(payload)
          .digest('hex');

        const event = await adapter.handleWebhook(payload, {
          'x-dlocal-signature': signature,
        });

        expect(event.type).toBe('payment.failed');
      });
    });

    it('accepts Buffer payload and normalizes correctly', async () => {
      const secret = 'whsec_123';
      const { adapter } = makeAdapter({ webhookSecret: secret });
      const payloadStr = JSON.stringify({
        id: 'evt_buf',
        type: 'payment.approved',
        payment_id: 'pay_buf',
      });
      const signature = createHmac('sha256', secret)
        .update(payloadStr)
        .digest('hex');

      const event = await adapter.handleWebhook(Buffer.from(payloadStr), {
        'x-dlocal-signature': signature,
      });

      expect(event.type).toBe('payment.completed');
      expect(event.transactionId).toBe('pay_buf');
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
          amount: 1500,
          currency: 'BRL',
          paymentMethod: { type: 'pix' },
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
          amount: 1500,
          currency: 'BRL',
          paymentMethod: { type: 'pix' },
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
          amount: 1500,
          currency: 'BRL',
          paymentMethod: { type: 'pix' },
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
          amount: 1500,
          currency: 'BRL',
          paymentMethod: { type: 'pix' },
        }),
      ).rejects.toMatchObject({
        code: 'CARD_DECLINED',
      });
    });

    it('maps HTTP 400 with fraud message to FRAUD_SUSPECTED', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(createJsonResponse({ message: 'fraud' }, 400));
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 1500,
          currency: 'BRL',
          paymentMethod: { type: 'pix' },
        }),
      ).rejects.toMatchObject({
        code: 'FRAUD_SUSPECTED',
      });
    });

    it('maps HTTP 400 with authentication_required message to AUTHENTICATION_REQUIRED', async () => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          createJsonResponse({ message: 'authentication_required' }, 400),
        );
      const client = createClient(fetchFn);

      await expect(
        client.charge({
          amount: 1500,
          currency: 'BRL',
          paymentMethod: { type: 'pix' },
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
          amount: 1500,
          currency: 'BRL',
          paymentMethod: { type: 'pix' },
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
      });
    });
  });
});
