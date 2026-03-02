import { describe, expect, it } from 'vitest';
import { VaultClient } from '../../src/client';
import { VaultConfigError } from '../../src/errors';
import type {
  AdapterMetadata,
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

const MINIMAL_METADATA: AdapterMetadata = {
  supportedMethods: ['card', 'pix'],
  supportedCurrencies: ['USD'],
  supportedCountries: ['US'],
};

class MinimalAdapter implements PaymentAdapter {
  static readonly supportedMethods = MINIMAL_METADATA.supportedMethods;
  static readonly supportedCurrencies = MINIMAL_METADATA.supportedCurrencies;
  static readonly supportedCountries = MINIMAL_METADATA.supportedCountries;
  readonly name: string;
  readonly metadata = MINIMAL_METADATA;

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
  it('throws when config root is not an object', () => {
    expect(() => new VaultClient(null as unknown as VaultConfig)).toThrow(
      VaultConfigError,
    );
    expect(() => new VaultClient(null as unknown as VaultConfig)).toThrow(
      'VaultClient configuration must be an object.',
    );
  });

  it('throws when providers is not a plain object', () => {
    const config = baseConfig();
    config.providers = [] as unknown as VaultConfig['providers'];

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'At least one provider must be configured.',
    );
  });

  it('throws when providers is empty', () => {
    const config = baseConfig();
    config.providers = {};

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'At least one provider must be configured.',
    );
  });

  it('throws when provider definition is not an object', () => {
    const config = baseConfig();
    config.providers.stripe =
      null as unknown as VaultConfig['providers']['stripe'];

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Provider configuration must be an object.',
    );
  });

  it('throws when provider adapter constructor is not a function', () => {
    const config = baseConfig();
    config.providers.stripe = {
      adapter:
        undefined as unknown as VaultConfig['providers']['stripe']['adapter'],
      config: { providerName: 'stripe' },
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Provider adapter constructor is missing.',
    );
  });

  it('throws when provider adapter is missing static supportedMethods metadata', () => {
    class BrokenAdapter extends MinimalAdapter {}
    Object.defineProperty(BrokenAdapter, 'supportedMethods', {
      value: undefined,
      configurable: true,
    });

    const config = baseConfig();
    config.providers.stripe.adapter =
      BrokenAdapter as unknown as VaultConfig['providers']['stripe']['adapter'];

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Provider adapter must declare static supportedMethods.',
    );
  });

  it('throws for non-integer provider priority', () => {
    const config = baseConfig();
    config.providers.stripe.priority = 1.5;

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Provider priority must be an integer.',
    );
  });

  it('throws when routing rules array is empty', () => {
    const config = baseConfig();
    config.routing = { rules: [] };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rules must include at least one rule when routing is configured.',
    );
  });

  it('throws when a routing rule is not an object', () => {
    const config = baseConfig();
    config.routing = {
      rules: [null as unknown as VaultConfig['routing']['rules'][number]],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule must be an object.',
    );
  });

  it('throws when a routing rule has no provider', () => {
    const config = baseConfig();
    config.routing = {
      rules: [
        { match: { currency: 'USD' }, provider: '' },
        { match: { default: true }, provider: 'stripe' },
      ],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule provider must be a non-empty string.',
    );
  });

  it('throws when a routing rule references an unknown provider', () => {
    const config = baseConfig();
    config.routing = {
      rules: [
        { match: { currency: 'USD' }, provider: 'paystack' },
        { match: { default: true }, provider: 'stripe' },
      ],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule provider must reference an enabled configured provider.',
    );
  });

  it('throws when routing rule match is missing', () => {
    const config = baseConfig();
    config.routing = {
      rules: [
        {
          match: undefined as unknown as NonNullable<
            VaultConfig['routing']
          >['rules'][number]['match'],
          provider: 'stripe',
        },
      ],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule match configuration is required.',
    );
  });

  it('throws when routing amountMin is negative', () => {
    const config = baseConfig();
    config.routing = {
      rules: [
        { match: { amountMin: -1 }, provider: 'stripe' },
        { match: { default: true }, provider: 'stripe' },
      ],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule amountMin must be a non-negative number.',
    );
  });

  it('throws when routing amountMax is negative', () => {
    const config = baseConfig();
    config.routing = {
      rules: [
        { match: { amountMax: -1 }, provider: 'stripe' },
        { match: { default: true }, provider: 'stripe' },
      ],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule amountMax must be a non-negative number.',
    );
  });

  it('throws when routing amountMin exceeds amountMax', () => {
    const config = baseConfig();
    config.routing = {
      rules: [
        { match: { amountMin: 200, amountMax: 100 }, provider: 'stripe' },
        { match: { default: true }, provider: 'stripe' },
      ],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule amountMin cannot exceed amountMax.',
    );
  });

  it('throws when routing rule weight is not positive', () => {
    const config = baseConfig();
    config.routing = {
      rules: [
        { match: { currency: 'USD' }, provider: 'stripe', weight: 0 },
        { match: { default: true }, provider: 'stripe' },
      ],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Routing rule weight must be a positive number.',
    );
  });

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

  it('throws for invalid platform timeout', () => {
    const config = baseConfig();
    config.platform = {
      timeoutMs: 0,
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'platform.timeoutMs must be a positive integer.',
    );
  });

  it('throws for empty platform baseUrl', () => {
    const config = baseConfig();
    config.platformApiKey = 'pk_test_123';
    config.platform = {
      baseUrl: '   ',
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'platform.baseUrl cannot be empty when provided.',
    );
  });

  it('throws for empty platformApiKey', () => {
    const config = baseConfig();
    config.platformApiKey = '  ';

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'platformApiKey cannot be empty when provided.',
    );
  });

  it('throws for invalid platform batch settings', () => {
    const batchSizeConfig = baseConfig();
    batchSizeConfig.platform = { batchSize: 0 };
    expect(() => new VaultClient(batchSizeConfig)).toThrow(
      'platform.batchSize must be a positive integer.',
    );

    const flushConfig = baseConfig();
    flushConfig.platform = { flushIntervalMs: 0 };
    expect(() => new VaultClient(flushConfig)).toThrow(
      'platform.flushIntervalMs must be a positive integer.',
    );

    const retriesConfig = baseConfig();
    retriesConfig.platform = { maxRetries: 0 };
    expect(() => new VaultClient(retriesConfig)).toThrow(
      'platform.maxRetries must be a positive integer.',
    );

    const backoffConfig = baseConfig();
    backoffConfig.platform = { initialBackoffMs: 0 };
    expect(() => new VaultClient(backoffConfig)).toThrow(
      'platform.initialBackoffMs must be a positive integer.',
    );
  });

  it('throws when idempotency store is missing required methods', () => {
    const config = baseConfig();
    config.idempotency = {
      store: {
        get() {
          return null;
        },
      } as unknown as NonNullable<VaultConfig['idempotency']>['store'],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Idempotency store is missing required methods.',
    );
  });

  it('throws for invalid logging level', () => {
    const config = baseConfig();
    config.logging = {
      level: 'trace' as VaultConfig['logging']['level'],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Invalid logging level configured.',
    );
  });

  it('throws when logger implementation misses required methods', () => {
    const config = baseConfig();
    config.logging = {
      logger: {
        error() {},
        warn() {},
        info() {},
      } as unknown as NonNullable<VaultConfig['logging']>['logger'],
    };

    expect(() => new VaultClient(config)).toThrow(VaultConfigError);
    expect(() => new VaultClient(config)).toThrow(
      'Logger implementation is missing a method.',
    );
  });

  it('accepts a fully valid advanced config shape', () => {
    const config = baseConfig();
    config.idempotency = {
      ttlMs: 60_000,
      store: {
        get() {
          return null;
        },
        set() {},
        delete() {},
        clearExpired() {},
      },
    };
    config.platformApiKey = 'pk_live_123';
    config.platform = {
      baseUrl: 'https://platform.vaultsaas.dev',
      timeoutMs: 1000,
      batchSize: 10,
      flushIntervalMs: 250,
      maxRetries: 2,
      initialBackoffMs: 50,
    };
    config.logging = {
      level: 'info',
      logger: {
        error() {},
        warn() {},
        info() {},
        debug() {},
      },
    };
    config.timeout = 1_500;
    config.routing = {
      rules: [
        {
          match: { currency: 'USD', amountMin: 100, amountMax: 10_000 },
          provider: 'stripe',
          weight: 1,
        },
        { match: { default: true }, provider: 'stripe' },
      ],
    };

    expect(() => new VaultClient(config)).not.toThrow();
  });
});
