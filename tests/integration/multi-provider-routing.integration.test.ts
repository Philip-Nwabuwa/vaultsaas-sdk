import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultClient } from '../../src/client';
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
  VaultEvent,
  VoidRequest,
  VoidResult,
} from '../../src/types';

const INTEGRATION_METADATA: AdapterMetadata = {
  supportedMethods: ['card', 'pix', 'bank_transfer', 'wallet'],
  supportedCurrencies: ['USD', 'BRL', 'NGN'],
  supportedCountries: ['US', 'BR', 'NG', 'GH', 'ZA', 'KE'],
};

class IntegrationAdapter implements PaymentAdapter {
  static readonly supportedMethods = INTEGRATION_METADATA.supportedMethods;
  static readonly supportedCurrencies =
    INTEGRATION_METADATA.supportedCurrencies;
  static readonly supportedCountries = INTEGRATION_METADATA.supportedCountries;
  readonly name: string;
  readonly metadata = INTEGRATION_METADATA;

  constructor(private readonly config: Record<string, unknown>) {
    this.name = String(config.providerName);
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    return {
      id: `vtxn_${this.name}_${request.currency.toLowerCase()}`,
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
        reason: `charged by ${this.name}`,
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
      paymentMethod: { type: 'card' },
      metadata: {},
      routing: {
        source: 'local',
        reason: `capture by ${this.name}`,
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
      id: `vevt_${this.name}`,
      type: 'payment.completed',
      provider: this.name,
      providerEventId: `evt_${this.name}`,
      data: {},
      rawPayload: {},
      timestamp: '2026-03-02T00:00:00.000Z',
    };
  }
}

function createMultiProviderClient(): VaultClient {
  return new VaultClient({
    providers: {
      stripe: {
        adapter: IntegrationAdapter,
        config: { providerName: 'stripe' },
      },
      dlocal: {
        adapter: IntegrationAdapter,
        config: { providerName: 'dlocal' },
      },
      paystack: {
        adapter: IntegrationAdapter,
        config: { providerName: 'paystack' },
      },
    },
    routing: {
      rules: [
        { match: { currency: 'BRL' }, provider: 'dlocal' },
        { match: { paymentMethod: 'card' }, provider: 'stripe', weight: 70 },
        { match: { paymentMethod: 'card' }, provider: 'paystack', weight: 30 },
        { match: { default: true }, provider: 'stripe' },
      ],
    },
  });
}

describe('VaultClient multi-provider routing integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes by rule and falls back to an eligible provider when exclusions remove matches', async () => {
    const client = createMultiProviderClient();

    const brlCharge = await client.charge({
      amount: 5000,
      currency: 'BRL',
      paymentMethod: { type: 'pix' },
    });
    expect(brlCharge.provider).toBe('dlocal');

    const fallbackCharge = await client.charge({
      amount: 2500,
      currency: 'USD',
      paymentMethod: { type: 'card' },
      routing: {
        exclude: ['stripe', 'paystack'],
      },
    });

    expect(fallbackCharge.provider).toBe('dlocal');
    expect(fallbackCharge.routing.reason).toBe('fallback provider');
  });

  it('respects provider override and weighted selection between providers', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.95);
    const client = createMultiProviderClient();

    const weightedCharge = await client.charge({
      amount: 1800,
      currency: 'USD',
      paymentMethod: { type: 'card' },
    });
    expect(weightedCharge.provider).toBe('paystack');
    expect(weightedCharge.routing.reason).toContain('weighted selection');

    const forcedCharge = await client.charge({
      amount: 1800,
      currency: 'USD',
      paymentMethod: { type: 'card' },
      routing: {
        provider: 'stripe',
      },
    });

    expect(forcedCharge.provider).toBe('stripe');
    expect(forcedCharge.routing.reason).toBe('forced provider');

    randomSpy.mockRestore();
  });
});
