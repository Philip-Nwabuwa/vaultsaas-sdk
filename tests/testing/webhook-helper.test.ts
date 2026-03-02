import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDLocalSignedWebhookPayload,
  createPaystackSignedWebhookPayload,
  createSignedWebhookPayload,
  createStripeSignedWebhookPayload,
} from '../../src/testing';

describe('webhook signing helpers', () => {
  it('creates Stripe-compatible signed payloads', () => {
    const secret = 'whsec_test_123';
    const payload = {
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      created: 1_777_777_777,
      data: {
        object: {
          id: 'pi_123',
        },
      },
    };
    const signed = createStripeSignedWebhookPayload(payload, secret, {
      timestamp: '1777777777',
    });

    const expected = createHmac('sha256', secret)
      .update(`1777777777.${JSON.stringify(payload)}`)
      .digest('hex');

    expect(signed.headers['stripe-signature']).toBe(
      `t=1777777777,v1=${expected}`,
    );
  });

  it('creates dLocal-compatible signed payloads', () => {
    const secret = 'whsec_test_123';
    const payload = {
      id: 'evt_1',
      type: 'payment.approved',
      payment_id: 'pay_123',
    };
    const signed = createDLocalSignedWebhookPayload(payload, secret);
    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    expect(signed.headers['x-dlocal-signature']).toBe(expected);
  });

  it('creates Paystack-compatible signed payloads', () => {
    const secret = 'whsec_test_123';
    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref_123',
        created_at: '2026-03-02T00:00:00.000Z',
      },
    };
    const signed = createPaystackSignedWebhookPayload(payload, secret);
    const expected = createHmac('sha512', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    expect(signed.headers['x-paystack-signature']).toBe(expected);
  });

  it('supports provider selection through createSignedWebhookPayload options', () => {
    const signed = createSignedWebhookPayload(
      {
        id: 'evt_1',
      },
      'secret_123',
      {
        provider: 'stripe',
        timestamp: 1_777_777_777,
      },
    );

    expect(signed.headers['stripe-signature']).toContain('t=1777777777');
    expect(signed.payload).toContain('"id":"evt_1"');
  });
});
