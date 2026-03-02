import { describe, expect, it } from 'vitest';
import { VaultClient } from '../../src/client';
import { VaultIdempotencyConflictError } from '../../src/errors';
import {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  type IdempotencyRecord,
  type IdempotencyStore,
} from '../../src/idempotency';
import type {
  AuthorizeRequest,
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

class CountingAdapter implements PaymentAdapter {
  readonly name: string;
  private readonly counter: { chargeCalls: number };

  constructor(config: Record<string, unknown>) {
    this.name = String(config.providerName ?? 'stripe');
    this.counter = config.counter as { chargeCalls: number };
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    this.counter.chargeCalls += 1;

    return {
      id: `vtxn_${this.counter.chargeCalls}`,
      status: 'completed',
      provider: this.name,
      providerId: `prov_${this.counter.chargeCalls}`,
      amount: request.amount,
      currency: request.currency,
      paymentMethod: { type: request.paymentMethod.type },
      metadata: request.metadata ?? {},
      routing: {
        source: 'local',
        reason: 'test route',
      },
      createdAt: '2026-03-02T00:00:00.000Z',
      providerMetadata: {},
    };
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    return this.charge(request);
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    return {
      id: request.transactionId,
      status: 'completed',
      provider: this.name,
      providerId: 'prov_capture',
      amount: request.amount ?? 100,
      currency: 'USD',
      paymentMethod: { type: 'card' },
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
      id: 'vref_1',
      transactionId: request.transactionId,
      status: 'completed',
      amount: request.amount ?? 100,
      currency: 'USD',
      provider: this.name,
      providerId: 'pref_1',
      createdAt: '2026-03-02T00:00:00.000Z',
      reason: request.reason,
    };
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    return {
      id: 'vvoid_1',
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
      providerId: 'prov_status',
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
        name: 'Card',
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

class SpyIdempotencyStore implements IdempotencyStore<unknown> {
  readonly records = new Map<string, IdempotencyRecord<unknown>>();
  lastSet: IdempotencyRecord<unknown> | null = null;

  get(key: string): IdempotencyRecord<unknown> | null {
    return this.records.get(key) ?? null;
  }

  set(record: IdempotencyRecord<unknown>): void {
    this.lastSet = record;
    this.records.set(record.key, record);
  }

  delete(key: string): void {
    this.records.delete(key);
  }

  clearExpired(): void {
    // no-op for this test spy
  }
}

function buildClient(config?: Partial<VaultConfig>): {
  client: VaultClient;
  counter: { chargeCalls: number };
} {
  const counter = { chargeCalls: 0 };
  const client = new VaultClient({
    providers: {
      stripe: {
        adapter: CountingAdapter,
        config: { providerName: 'stripe', counter },
      },
    },
    routing: {
      rules: [{ match: { default: true }, provider: 'stripe' }],
    },
    ...config,
  });

  return { client, counter };
}

describe('VaultClient idempotency', () => {
  it('replays original result for same idempotency key and same payload', async () => {
    const { client, counter } = buildClient();

    const request: ChargeRequest = {
      amount: 2500,
      currency: 'USD',
      paymentMethod: { type: 'pix' },
      idempotencyKey: 'idk_order_1',
    };

    const first = await client.charge(request);
    const second = await client.charge(request);

    expect(first.id).toBe(second.id);
    expect(counter.chargeCalls).toBe(1);
  });

  it('throws conflict error when same key is reused with a different payload', async () => {
    const { client, counter } = buildClient();

    await client.charge({
      amount: 1000,
      currency: 'USD',
      paymentMethod: { type: 'pix' },
      idempotencyKey: 'idk_conflict',
    });

    await expect(
      client.charge({
        amount: 2000,
        currency: 'USD',
        paymentMethod: { type: 'pix' },
        idempotencyKey: 'idk_conflict',
      }),
    ).rejects.toBeInstanceOf(VaultIdempotencyConflictError);

    expect(counter.chargeCalls).toBe(1);
  });

  it('uses configured ttl and defaults to 24h when ttl is not provided', async () => {
    const customStore = new SpyIdempotencyStore();
    const customTtlMs = 5_000;
    const customWindowStart = Date.now();

    const { client: customClient } = buildClient({
      idempotency: {
        store: customStore,
        ttlMs: customTtlMs,
      },
    });

    await customClient.charge({
      amount: 1000,
      currency: 'USD',
      paymentMethod: { type: 'pix' },
      idempotencyKey: 'idk_custom_ttl',
    });

    const customWindowEnd = Date.now();
    expect(customStore.lastSet).not.toBeNull();
    expect(customStore.lastSet?.expiresAt).toBeGreaterThanOrEqual(
      customWindowStart + customTtlMs,
    );
    expect(customStore.lastSet?.expiresAt).toBeLessThanOrEqual(
      customWindowEnd + customTtlMs,
    );

    const defaultStore = new SpyIdempotencyStore();
    const defaultWindowStart = Date.now();

    const { client: defaultClient } = buildClient({
      idempotency: {
        store: defaultStore,
      },
    });

    await defaultClient.charge({
      amount: 1000,
      currency: 'USD',
      paymentMethod: { type: 'pix' },
      idempotencyKey: 'idk_default_ttl',
    });

    const defaultWindowEnd = Date.now();
    expect(defaultStore.lastSet).not.toBeNull();
    expect(defaultStore.lastSet?.expiresAt).toBeGreaterThanOrEqual(
      defaultWindowStart + DEFAULT_IDEMPOTENCY_TTL_MS,
    );
    expect(defaultStore.lastSet?.expiresAt).toBeLessThanOrEqual(
      defaultWindowEnd + DEFAULT_IDEMPOTENCY_TTL_MS,
    );
  });
});
