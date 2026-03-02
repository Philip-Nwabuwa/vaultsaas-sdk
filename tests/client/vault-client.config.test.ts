import { describe, expect, it } from 'vitest';
import { VaultClient } from '../../src/client';
import { VaultConfigError } from '../../src/errors';
import type {
  CaptureRequest,
  ChargeRequest,
  PaymentAdapter,
  PaymentMethodInfo,
  PaymentResult,
  RefundRequest,
  RefundResult,
  TransactionStatus,
  VaultConfig,
  VaultEvent,
  VoidRequest,
  VoidResult,
} from '../../src/types';

class MinimalAdapter implements PaymentAdapter {
  readonly name: string;

  constructor(config: Record<string, unknown>) {
    this.name = String(config.providerName ?? 'minimal');
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    return {
      id: 'vtxn_1',
      status: 'completed',
      provider: this.name,
      providerId: 'prov_1',
      amount: request.amount,
      currency: request.currency,
      paymentMethod: { type: request.paymentMethod.type },
      metadata: {},
      routing: { source: 'local', reason: 'test' },
      createdAt: '2026-03-02T00:00:00.000Z',
      providerMetadata: {},
    };
  }

  async authorize(request: ChargeRequest): Promise<PaymentResult> {
    return this.charge(request);
  }

  async capture(_request: CaptureRequest): Promise<PaymentResult> {
    return this.charge({
      amount: 100,
      currency: 'USD',
      paymentMethod: { type: 'pix' },
    });
  }

  async refund(_request: RefundRequest): Promise<RefundResult> {
    return {
      id: 'vref_1',
      transactionId: 'vtxn_1',
      status: 'completed',
      amount: 100,
      currency: 'USD',
      provider: this.name,
      providerId: 'pref_1',
      createdAt: '2026-03-02T00:00:00.000Z',
    };
  }

  async void(_request: VoidRequest): Promise<VoidResult> {
    return {
      id: 'vvoid_1',
      transactionId: 'vtxn_1',
      status: 'completed',
      provider: this.name,
      createdAt: '2026-03-02T00:00:00.000Z',
    };
  }

  async getStatus(_transactionId: string): Promise<TransactionStatus> {
    return {
      id: 'vtxn_1',
      status: 'completed',
      provider: this.name,
      providerId: 'prov_1',
      amount: 100,
      currency: 'USD',
      history: [],
      updatedAt: '2026-03-02T00:00:00.000Z',
    };
  }

  async listPaymentMethods(
    _country: string,
    _currency: string,
  ): Promise<PaymentMethodInfo[]> {
    return [];
  }

  async handleWebhook(
    _payload: Buffer | string,
    _headers: Record<string, string>,
  ): Promise<VaultEvent> {
    return {
      id: 'vevt_1',
      type: 'payment.completed',
      provider: this.name,
      providerEventId: 'evt_1',
      data: {},
      rawPayload: {},
      timestamp: '2026-03-02T00:00:00.000Z',
    };
  }
}

function baseConfig(): VaultConfig {
  return {
    providers: {
      stripe: {
        adapter: MinimalAdapter,
        config: { providerName: 'stripe' },
      },
    },
    routing: {
      rules: [{ match: { default: true }, provider: 'stripe' }],
    },
  };
}

describe('VaultClient config validation', () => {
  it('throws for missing default routing rule when routing is configured', () => {
    const config = baseConfig();
    config.routing = {
      rules: [{ match: { currency: 'USD' }, provider: 'stripe' }],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing configuration must include a default fallback rule.',
    );
  });

  it('throws for invalid timeout', () => {
    const config = baseConfig();
    config.timeout = 0;

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'timeout must be a positive integer.',
    );
  });

  it('throws for invalid provider config shape', () => {
    const config = baseConfig();
    config.providers.stripe = {
      adapter: MinimalAdapter,
      config: null as unknown as Record<string, unknown>,
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Provider config must be a plain object.',
    );
  });

  it('throws when routing references disabled provider', () => {
    const config = baseConfig();
    config.providers.stripe.enabled = false;

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'No enabled providers are available.',
    );
  });

  it('throws for invalid idempotency ttl', () => {
    const config = baseConfig();
    config.idempotency = {
      ttlMs: -1,
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'idempotency.ttlMs must be a positive integer.',
    );
  });
});
