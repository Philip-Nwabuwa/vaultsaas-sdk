import { describe, expect, it } from 'vitest';
import { VaultClient } from '../../src/client';
import type {
  CaptureRequest,
  ChargeRequest,
  PaymentAdapter,
  PaymentMethodInfo,
  PaymentResult,
  RefundRequest,
  RefundResult,
  TransactionStatus,
  VaultEvent,
  VoidRequest,
  VoidResult,
} from '../../src/types';

class TestAdapter implements PaymentAdapter {
  readonly name: string;

  constructor(private readonly config: Record<string, unknown>) {
    this.name = String(config.providerName);
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    return {
      id: `vtxn_${this.name}`,
      status: 'completed',
      provider: this.name,
      providerId: `prov_${this.name}_charge`,
      amount: request.amount,
      currency: request.currency,
      paymentMethod: {
        type: request.paymentMethod.type,
      },
      metadata: request.metadata ?? {},
      routing: {
        source: 'local',
        reason: 'adapter route',
      },
      createdAt: '2026-03-02T00:00:00.000Z',
      providerMetadata: {},
    };
  }

  async authorize(request: ChargeRequest): Promise<PaymentResult> {
    return {
      ...(await this.charge(request)),
      status: 'authorized',
      providerId: `prov_${this.name}_authorize`,
    };
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    return {
      id: request.transactionId,
      status: 'completed',
      provider: this.name,
      providerId: `prov_${this.name}_capture`,
      amount: request.amount ?? 100,
      currency: 'USD',
      paymentMethod: {
        type: 'card',
      },
      metadata: {},
      routing: {
        source: 'local',
        reason: 'capture',
      },
      createdAt: '2026-03-02T00:00:00.000Z',
      providerMetadata: {},
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return {
      id: `vref_${this.name}`,
      transactionId: request.transactionId,
      status: 'completed',
      amount: request.amount ?? 100,
      currency: 'USD',
      provider: this.name,
      providerId: `prov_${this.name}_refund`,
      createdAt: '2026-03-02T00:00:00.000Z',
      reason: request.reason,
    };
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    return {
      id: `vvoid_${this.name}`,
      transactionId: request.transactionId,
      status: 'completed',
      provider: this.name,
      createdAt: '2026-03-02T00:00:00.000Z',
    };
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    return {
      id: transactionId,
      status: 'completed',
      provider: this.name,
      providerId: `prov_${this.name}_status`,
      amount: 100,
      currency: 'USD',
      history: [],
      updatedAt: '2026-03-02T00:00:00.000Z',
    };
  }

  async listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodInfo[]> {
    return [
      {
        type: 'card',
        provider: this.name,
        name: `${this.name.toUpperCase()} Card`,
        countries: [country],
        currencies: [currency],
      },
    ];
  }

  async handleWebhook(
    _payload: Buffer | string,
    _headers: Record<string, string>,
  ): Promise<VaultEvent> {
    return {
      id: `vevt_${this.name}`,
      type: 'payment.completed',
      provider: this.name,
      transactionId: `vtxn_${this.name}`,
      providerEventId: `evt_${this.name}`,
      data: {},
      rawPayload: {},
      timestamp: '2026-03-02T00:00:00.000Z',
    };
  }
}

function createClient(): VaultClient {
  return new VaultClient({
    providers: {
      stripe: {
        adapter: TestAdapter,
        config: { providerName: 'stripe' },
      },
      dlocal: {
        adapter: TestAdapter,
        config: { providerName: 'dlocal' },
      },
    },
    routing: {
      rules: [
        { match: { currency: 'BRL' }, provider: 'dlocal' },
        { match: { default: true }, provider: 'stripe' },
      ],
    },
  });
}

describe('VaultClient', () => {
  it('routes charge by rule and reuses transaction provider for capture', async () => {
    const client = createClient();

    const charged = await client.charge({
      amount: 5000,
      currency: 'BRL',
      paymentMethod: { type: 'pix' },
      metadata: { orderId: 'ord_123' },
    });

    expect(charged.provider).toBe('dlocal');
    expect(charged.routing.reason).toContain('rule matched');

    const captured = await client.capture({
      transactionId: charged.id,
    });

    expect(captured.provider).toBe('dlocal');
  });

  it('aggregates payment methods from enabled adapters', async () => {
    const client = createClient();

    const methods = await client.listPaymentMethods('BR', 'BRL');

    expect(methods).toHaveLength(2);
    expect(methods.map((method) => method.provider).sort()).toEqual([
      'dlocal',
      'stripe',
    ]);
  });

  it('delegates webhook handling to adapter when available', async () => {
    const client = createClient();

    const event = await client.handleWebhook('stripe', '{"id":"evt_1"}', {});

    expect(event.provider).toBe('stripe');
    expect(event.type).toBe('payment.completed');
  });
});
