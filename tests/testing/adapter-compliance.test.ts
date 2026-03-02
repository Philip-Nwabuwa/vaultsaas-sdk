import { describe, expect, it } from 'vitest';
import {
  AdapterComplianceError,
  MockAdapter,
  createAdapterComplianceHarness,
} from '../../src/testing';
import type {
  PaymentMethodInfo,
  PaymentResult,
  RefundResult,
  TransactionStatus,
  VoidResult,
} from '../../src/types';

function createPaymentResult(provider: string): PaymentResult {
  return {
    id: 'txn_123',
    status: 'completed',
    provider,
    providerId: 'provider_123',
    amount: 2500,
    currency: 'USD',
    paymentMethod: {
      type: 'card',
      last4: '4242',
    },
    metadata: {},
    routing: {
      source: 'local',
      reason: 'test',
    },
    createdAt: '2026-03-02T00:00:00.000Z',
    providerMetadata: {},
  };
}

function createRefundResult(provider: string): RefundResult {
  return {
    id: 'refund_123',
    transactionId: 'txn_123',
    status: 'completed',
    amount: 500,
    currency: 'USD',
    provider,
    providerId: 'provider_refund_123',
    createdAt: '2026-03-02T00:00:00.000Z',
  };
}

function createVoidResult(provider: string): VoidResult {
  return {
    id: 'void_123',
    transactionId: 'txn_123',
    status: 'completed',
    provider,
    createdAt: '2026-03-02T00:00:00.000Z',
  };
}

function createTransactionStatus(provider: string): TransactionStatus {
  return {
    id: 'txn_123',
    status: 'completed',
    provider,
    providerId: 'provider_123',
    amount: 2500,
    currency: 'USD',
    history: [
      {
        status: 'pending',
        timestamp: '2026-03-02T00:00:00.000Z',
      },
      {
        status: 'completed',
        timestamp: '2026-03-02T00:00:01.000Z',
      },
    ],
    updatedAt: '2026-03-02T00:00:01.000Z',
  };
}

function createPaymentMethods(provider: string): PaymentMethodInfo[] {
  return [
    {
      type: 'card',
      provider,
      name: 'Card',
      currencies: ['USD'],
      countries: ['US'],
    },
  ];
}

describe('createAdapterComplianceHarness', () => {
  it('validates all adapter operation outputs', async () => {
    const adapter = new MockAdapter({
      name: 'mock',
      handlers: {
        charge: async () => createPaymentResult('mock'),
        authorize: async () => createPaymentResult('mock'),
        capture: async () => createPaymentResult('mock'),
        refund: async () => createRefundResult('mock'),
        void: async () => createVoidResult('mock'),
        getStatus: async () => createTransactionStatus('mock'),
        listPaymentMethods: async () => createPaymentMethods('mock'),
        handleWebhook: async () => ({
          id: 'vevt_mock_1',
          type: 'payment.completed',
          provider: 'mock',
          providerEventId: 'evt_1',
          transactionId: 'txn_123',
          data: {},
          rawPayload: '{}',
          timestamp: '2026-03-02T00:00:00.000Z',
        }),
      },
    });
    const harness = createAdapterComplianceHarness(adapter);

    await expect(
      harness.charge({
        amount: 2500,
        currency: 'USD',
        paymentMethod: {
          type: 'card',
          token: 'pm_card_visa',
        },
      }),
    ).resolves.toMatchObject({ provider: 'mock' });
    await expect(
      harness.authorize({
        amount: 2500,
        currency: 'USD',
        paymentMethod: {
          type: 'card',
          token: 'pm_card_visa',
        },
      }),
    ).resolves.toMatchObject({ provider: 'mock' });
    await expect(
      harness.capture({
        transactionId: 'txn_123',
      }),
    ).resolves.toMatchObject({ provider: 'mock' });
    await expect(
      harness.refund({
        transactionId: 'txn_123',
      }),
    ).resolves.toMatchObject({ provider: 'mock' });
    await expect(
      harness.void({
        transactionId: 'txn_123',
      }),
    ).resolves.toMatchObject({ provider: 'mock' });
    await expect(harness.getStatus('txn_123')).resolves.toMatchObject({
      provider: 'mock',
    });
    await expect(
      harness.listPaymentMethods('US', 'USD'),
    ).resolves.toMatchObject([{ provider: 'mock' }]);
    await expect(harness.handleWebhook('{}', {})).resolves.toMatchObject({
      provider: 'mock',
    });
  });

  it('throws AdapterComplianceError for invalid operation output', async () => {
    const adapter = new MockAdapter({
      name: 'mock',
      handlers: {
        charge: async () => ({ id: '' }) as PaymentResult,
      },
    });
    const harness = createAdapterComplianceHarness(adapter);

    await expect(
      harness.charge({
        amount: 2500,
        currency: 'USD',
        paymentMethod: {
          type: 'card',
          token: 'pm_card_visa',
        },
      }),
    ).rejects.toBeInstanceOf(AdapterComplianceError);
  });

  it('throws when expectedProvider does not match adapter output', async () => {
    const adapter = new MockAdapter({
      name: 'mock',
      handlers: {
        charge: async () => createPaymentResult('stripe'),
      },
    });
    const harness = createAdapterComplianceHarness(adapter, {
      expectedProvider: 'mock',
    });

    await expect(
      harness.charge({
        amount: 2500,
        currency: 'USD',
        paymentMethod: {
          type: 'card',
          token: 'pm_card_visa',
        },
      }),
    ).rejects.toThrow('provider must equal "mock"');
  });

  it('throws for handleWebhook when adapter does not implement it', async () => {
    const adapter = {
      name: 'mock',
      async charge() {
        return createPaymentResult('mock');
      },
      async authorize() {
        return createPaymentResult('mock');
      },
      async capture() {
        return createPaymentResult('mock');
      },
      async refund() {
        return createRefundResult('mock');
      },
      async void() {
        return createVoidResult('mock');
      },
      async getStatus() {
        return createTransactionStatus('mock');
      },
      async listPaymentMethods() {
        return createPaymentMethods('mock');
      },
    };
    const harness = createAdapterComplianceHarness(adapter);

    await expect(harness.handleWebhook('{}', {})).rejects.toBeInstanceOf(
      AdapterComplianceError,
    );
  });
});
