import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultClient } from '../../src/client';
import { VaultNetworkError, VaultRoutingError } from '../../src/errors';
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

class VaultErrorAdapter extends TestAdapter {
  async charge(_request: ChargeRequest): Promise<PaymentResult> {
    throw new VaultRoutingError('Pre-normalized routing error', {
      code: 'ROUTING_PROVIDER_UNAVAILABLE',
    });
  }
}

class WebhooklessAdapter implements PaymentAdapter {
  readonly name: string;
  private readonly delegate: TestAdapter;

  constructor(config: Record<string, unknown>) {
    this.delegate = new TestAdapter(config);
    this.name = this.delegate.name;
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    return this.delegate.charge(request);
  }

  async authorize(request: ChargeRequest): Promise<PaymentResult> {
    return this.delegate.authorize(request);
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    return this.delegate.capture(request);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return this.delegate.refund(request);
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    return this.delegate.void(request);
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    return this.delegate.getStatus(transactionId);
  }

  async listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodInfo[]> {
    return this.delegate.listPaymentMethods(country, currency);
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

  it('falls back to local routing when platform returns no provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ reason: 'insufficient data' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const client = new VaultClient({
      providers: {
        stripe: {
          adapter: TestAdapter,
          config: { providerName: 'stripe' },
        },
      },
      platformApiKey: 'pk_test_123',
      platform: {
        baseUrl: 'https://platform.test',
      },
    });

    const result = await client.charge({
      amount: 1200,
      currency: 'USD',
      paymentMethod: {
        type: 'card',
        number: '4242',
        expMonth: 12,
        expYear: 2030,
        cvc: '123',
      },
    });

    expect(result.provider).toBe('stripe');
    expect(result.routing.source).toBe('local');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to local routing when platform provider is excluded by request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          provider: 'stripe',
          reason: 'platform selected stripe',
          decisionId: 'dec_excluded',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
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
        rules: [{ match: { default: true }, provider: 'dlocal' }],
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
      routing: {
        exclude: ['stripe'],
      },
    });

    expect(result.provider).toBe('dlocal');
    expect(result.routing.source).toBe('local');
  });

  it('throws when forced provider is also excluded', async () => {
    const client = createClient();

    await expect(
      client.charge({
        amount: 2000,
        currency: 'USD',
        paymentMethod: { type: 'card', token: 'tok_test' },
        routing: {
          provider: 'stripe',
          exclude: ['stripe'],
        },
      }),
    ).rejects.toMatchObject({
      code: 'ROUTING_PROVIDER_EXCLUDED',
      category: 'routing_error',
    });
  });

  it('throws when forced provider is not configured', async () => {
    const client = createClient();

    await expect(
      client.charge({
        amount: 2000,
        currency: 'USD',
        paymentMethod: { type: 'card', token: 'tok_test' },
        routing: {
          provider: 'paystack',
        },
      }),
    ).rejects.toMatchObject({
      code: 'ROUTING_PROVIDER_UNAVAILABLE',
      category: 'routing_error',
    });
  });

  it('uses local fallback provider when no routing config is present', async () => {
    const client = new VaultClient({
      providers: {
        stripe: {
          adapter: TestAdapter,
          config: { providerName: 'stripe' },
          priority: 10,
        },
        dlocal: {
          adapter: TestAdapter,
          config: { providerName: 'dlocal' },
          priority: 1,
        },
      },
    });

    const result = await client.charge({
      amount: 1500,
      currency: 'USD',
      paymentMethod: { type: 'card', token: 'tok_test' },
    });

    expect(result.provider).toBe('dlocal');
    expect(result.routing.reason).toBe('fallback provider');
  });

  it('normalizes webhook payload when adapter does not implement handleWebhook', async () => {
    const client = new VaultClient({
      providers: {
        stripe: {
          adapter: WebhooklessAdapter,
          config: { providerName: 'stripe' },
        },
      },
      routing: {
        rules: [{ match: { default: true }, provider: 'stripe' }],
      },
    });

    const event = await client.handleWebhook('stripe', 'not-json', {
      'content-type': 'application/json',
    });

    expect(event.provider).toBe('stripe');
    expect(event.type).toBe('payment.failed');
    expect(event.data).toEqual({ payload: 'not-json' });
  });

  it('preserves VaultError instances thrown by adapters', async () => {
    const client = createSingleProviderClient(VaultErrorAdapter);

    await expect(
      client.charge({
        amount: 1200,
        currency: 'USD',
        paymentMethod: { type: 'card', token: 'tok_test' },
      }),
    ).rejects.toMatchObject({
      message: 'Pre-normalized routing error',
      code: 'ROUTING_PROVIDER_UNAVAILABLE',
      category: 'routing_error',
    });
  });
});
