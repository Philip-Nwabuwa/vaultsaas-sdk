import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultClient } from '../../src/client';
import { VaultNetworkError } from '../../src/errors';
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

class RateLimitedAdapter extends TestAdapter {
  async charge(_request: ChargeRequest): Promise<PaymentResult> {
    throw {
      message: 'Too many requests',
      status: 429,
      providerCode: 'rate_limit',
    };
  }
}

class TimeoutAdapter extends TestAdapter {
  async charge(_request: ChargeRequest): Promise<PaymentResult> {
    const error = new Error('socket timeout') as Error & { code: string };
    error.code = 'ETIMEDOUT';
    throw error;
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

function createSingleProviderClient(
  adapter: new (config: Record<string, unknown>) => PaymentAdapter,
): VaultClient {
  return new VaultClient({
    providers: {
      stripe: {
        adapter,
        config: { providerName: 'stripe' },
      },
    },
    routing: {
      rules: [{ match: { default: true }, provider: 'stripe' }],
    },
  });
}

describe('VaultClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('maps provider failures to canonical VaultProviderError values', async () => {
    const client = createSingleProviderClient(RateLimitedAdapter);

    await expect(
      client.charge({
        amount: 1000,
        currency: 'USD',
        paymentMethod: { type: 'card' },
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      category: 'rate_limited',
      retriable: true,
      context: {
        provider: 'stripe',
        operation: 'charge',
      },
    });
  });

  it('maps timeout failures to VaultNetworkError', async () => {
    const client = createSingleProviderClient(TimeoutAdapter);

    await expect(
      client.charge({
        amount: 1000,
        currency: 'USD',
        paymentMethod: { type: 'card' },
      }),
    ).rejects.toBeInstanceOf(VaultNetworkError);

    await expect(
      client.charge({
        amount: 1000,
        currency: 'USD',
        paymentMethod: { type: 'card' },
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      category: 'network_error',
      retriable: true,
    });
  });

  it('uses platform routing decision when available', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          provider: 'dlocal',
          source: 'smart',
          reason: 'Platform selected dlocal.',
          decisionId: 'dec_123',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const client = new VaultClient({
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
        rules: [{ match: { default: true }, provider: 'stripe' }],
      },
      platformApiKey: 'pk_test_123',
      platform: {
        baseUrl: 'https://platform.test',
      },
    });

    const result = await client.charge({
      amount: 1200,
      currency: 'USD',
      paymentMethod: { type: 'card', token: 'tok_test' },
    });

    expect(result.provider).toBe('dlocal');
    expect(result.routing.source).toBe('platform');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to local routing when platform request fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'));

    const client = new VaultClient({
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
        rules: [{ match: { default: true }, provider: 'stripe' }],
      },
      platformApiKey: 'pk_test_123',
      platform: {
        baseUrl: 'https://platform.test',
      },
    });

    const result = await client.charge({
      amount: 1200,
      currency: 'USD',
      paymentMethod: { type: 'card', token: 'tok_test' },
    });

    expect(result.provider).toBe('stripe');
    expect(result.routing.source).toBe('local');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
