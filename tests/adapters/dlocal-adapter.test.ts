import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DLocalAdapter } from '../../src/adapters';
import { WebhookVerificationError } from '../../src/errors';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('DLocalAdapter', () => {
  it('normalizes charge responses', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        id: 'dl_123',
        payment_id: 'pay_123',
        status: 'APPROVED',
        amount: 1500,
        currency: 'BRL',
        payment_method_id: 'PIX',
        created_date: '2026-03-02T00:00:00.000Z',
      }),
    );
    const adapter = new DLocalAdapter({
      xLogin: 'login_123',
      xTransKey: 'trans_123',
      secretKey: 'secret_123',
      fetchFn,
    });

    const result = await adapter.charge({
      amount: 1500,
      currency: 'BRL',
      paymentMethod: { type: 'pix' },
      customer: {
        email: 'customer@example.com',
      },
    });

    expect(result.id).toBe('pay_123');
    expect(result.provider).toBe('dlocal');
    expect(result.status).toBe('completed');
    expect(result.currency).toBe('BRL');

    const requestInit = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = requestInit?.headers as Record<string, string>;
    expect(headers['x-login']).toBe('login_123');
  });

  it('verifies and normalizes dLocal webhooks', async () => {
    const secret = 'whsec_123';
    const adapter = new DLocalAdapter({
      xLogin: 'login_123',
      xTransKey: 'trans_123',
      secretKey: 'secret_123',
      webhookSecret: secret,
      fetchFn: vi.fn<typeof fetch>(),
    });
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
  });

  it('throws for invalid dLocal webhook signature', async () => {
    const adapter = new DLocalAdapter({
      xLogin: 'login_123',
      xTransKey: 'trans_123',
      secretKey: 'secret_123',
      fetchFn: vi.fn<typeof fetch>(),
    });

    await expect(
      adapter.handleWebhook('{"id":"evt_1"}', {
        'x-dlocal-signature': 'deadbeef',
      }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });
});
