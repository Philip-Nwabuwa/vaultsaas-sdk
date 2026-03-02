import {
  VaultConfigError,
  VaultError,
  VaultIdempotencyConflictError,
  VaultRoutingError,
  mapProviderError,
} from '../errors';
import {
  DEFAULT_IDEMPOTENCY_TTL_MS,
  type IdempotencyStore,
  MemoryIdempotencyStore,
  hashIdempotencyPayload,
} from '../idempotency';
import { PlatformConnector, type PlatformTransactionReport } from '../platform';
import { Router } from '../router';
import type {
  AuthorizeRequest,
  CaptureRequest,
  ChargeRequest,
  PaymentAdapter,
  PaymentMethodInfo,
  PaymentResult,
  RefundRequest,
  RefundResult,
  RoutingContext,
  TransactionStatus,
  VaultConfig,
  VaultEvent,
  VoidRequest,
  VoidResult,
} from '../types';
import {
  type ProviderWebhookPayload,
  normalizeWebhookEvent,
} from '../webhooks';
import { validateVaultConfig } from './config-validation';

interface ResolvedProvider {
  provider: string;
  source: 'local' | 'platform';
  reason: string;
  decisionId?: string;
}

interface IdempotentRequest {
  idempotencyKey?: string;
}

export class VaultClient {
  readonly config: VaultConfig;
  private readonly adapters = new Map<string, PaymentAdapter>();
  private readonly providerOrder: string[];
  private readonly router: Router | null;
  private readonly platformConnector: PlatformConnector | null;
  private readonly idempotencyStore: IdempotencyStore;
  private readonly idempotencyTtlMs: number;
  private readonly transactionProviderIndex = new Map<string, string>();

  constructor(config: VaultConfig) {
    validateVaultConfig(config);
    this.config = config;

    const entries = Object.entries(config.providers);

    this.providerOrder = entries
      .filter(([, provider]) => provider.enabled !== false)
      .sort(([, a], [, b]) => (a.priority ?? 0) - (b.priority ?? 0))
      .map(([name, provider]) => {
        if (!provider.adapter) {
          throw new VaultConfigError(
            'Provider adapter constructor is missing.',
            {
              code: 'PROVIDER_NOT_CONFIGURED',
              context: {
                provider: name,
              },
            },
          );
        }

        this.adapters.set(name, new provider.adapter(provider.config));
        return name;
      });

    if (this.providerOrder.length === 0) {
      throw new VaultConfigError('No enabled providers are available.');
    }

    this.router = config.routing?.rules?.length
      ? new Router(config.routing.rules)
      : null;
    this.platformConnector = config.platformApiKey
      ? new PlatformConnector({
          apiKey: config.platformApiKey,
          baseUrl: config.platform?.baseUrl,
          timeoutMs: config.platform?.timeoutMs,
          batchSize: config.platform?.batchSize,
          flushIntervalMs: config.platform?.flushIntervalMs,
          maxRetries: config.platform?.maxRetries,
          initialBackoffMs: config.platform?.initialBackoffMs,
          logger: config.logging?.logger,
        })
      : null;
    this.idempotencyStore =
      config.idempotency?.store ?? new MemoryIdempotencyStore();
    this.idempotencyTtlMs =
      config.idempotency?.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    return this.executeIdempotentOperation('charge', request, async () => {
      const route = await this.resolveProviderForCharge(request);
      const adapter = this.getAdapter(route.provider);
      const startedAt = Date.now();
      const result = await this.wrapProviderCall(route.provider, 'charge', () =>
        adapter.charge(request),
      );
      const latencyMs = Date.now() - startedAt;

      const normalized = this.withRouting(result, route, request);
      this.transactionProviderIndex.set(normalized.id, route.provider);
      this.queueTransactionReport({
        id: normalized.id,
        provider: normalized.provider,
        providerId: normalized.providerId,
        status: normalized.status,
        amount: normalized.amount,
        currency: normalized.currency,
        country: request.customer?.address?.country,
        paymentMethod: normalized.paymentMethod.type,
        cardBin: this.extractCardBin(request),
        cardBrand: normalized.paymentMethod.brand,
        latencyMs,
        routingSource: normalized.routing.source,
        routingDecisionId: route.decisionId,
        idempotencyKey: request.idempotencyKey,
        timestamp: normalized.createdAt,
      });
      return normalized;
    });
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    return this.executeIdempotentOperation('authorize', request, async () => {
      const route = await this.resolveProviderForCharge(request);
      const adapter = this.getAdapter(route.provider);
      const startedAt = Date.now();
      const result = await this.wrapProviderCall(
        route.provider,
        'authorize',
        () => adapter.authorize(request),
      );
      const latencyMs = Date.now() - startedAt;

      const normalized = this.withRouting(result, route, request);
      this.transactionProviderIndex.set(normalized.id, route.provider);
      this.queueTransactionReport({
        id: normalized.id,
        provider: normalized.provider,
        providerId: normalized.providerId,
        status: normalized.status,
        amount: normalized.amount,
        currency: normalized.currency,
        country: request.customer?.address?.country,
        paymentMethod: normalized.paymentMethod.type,
        cardBin: this.extractCardBin(request),
        cardBrand: normalized.paymentMethod.brand,
        latencyMs,
        routingSource: normalized.routing.source,
        routingDecisionId: route.decisionId,
        idempotencyKey: request.idempotencyKey,
        timestamp: normalized.createdAt,
      });
      return normalized;
    });
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    return this.executeIdempotentOperation('capture', request, async () => {
      const provider = this.resolveProviderForTransaction(
        request.transactionId,
      );
      const adapter = this.getAdapter(provider);
      const startedAt = Date.now();
      const result = await this.wrapProviderCall(provider, 'capture', () =>
        adapter.capture(request),
      );
      const latencyMs = Date.now() - startedAt;

      const normalized = this.withRouting(result, {
        provider,
        source: 'local',
        reason: 'transaction provider lookup',
      });

      this.transactionProviderIndex.set(normalized.id, provider);
      this.queueTransactionReport({
        id: normalized.id,
        provider: normalized.provider,
        providerId: normalized.providerId,
        status: normalized.status,
        amount: normalized.amount,
        currency: normalized.currency,
        paymentMethod: normalized.paymentMethod.type,
        cardBrand: normalized.paymentMethod.brand,
        latencyMs,
        routingSource: normalized.routing.source,
        idempotencyKey: request.idempotencyKey,
        timestamp: normalized.createdAt,
      });
      return normalized;
    });
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    return this.executeIdempotentOperation('refund', request, async () => {
      const provider = this.resolveProviderForTransaction(
        request.transactionId,
      );
      const adapter = this.getAdapter(provider);
      const startedAt = Date.now();
      const result = await this.wrapProviderCall(provider, 'refund', () =>
        adapter.refund(request),
      );
      const latencyMs = Date.now() - startedAt;

      this.queueTransactionReport({
        id: result.id,
        provider: result.provider,
        providerId: result.providerId,
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        latencyMs,
        idempotencyKey: request.idempotencyKey,
        timestamp: result.createdAt,
      });
      return result;
    });
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    return this.executeIdempotentOperation('void', request, async () => {
      const provider = this.resolveProviderForTransaction(
        request.transactionId,
      );
      const adapter = this.getAdapter(provider);
      const result = await this.wrapProviderCall(provider, 'void', () =>
        adapter.void(request),
      );
      this.queueTransactionReport({
        id: result.id,
        provider: result.provider,
        status: result.status,
        amount: 0,
        currency: 'N/A',
        idempotencyKey: request.idempotencyKey,
        timestamp: result.createdAt,
      });

      return result;
    });
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    const provider = this.resolveProviderForTransaction(transactionId);
    const adapter = this.getAdapter(provider);
    const startedAt = Date.now();
    const status = await this.wrapProviderCall(provider, 'getStatus', () =>
      adapter.getStatus(transactionId),
    );
    const latencyMs = Date.now() - startedAt;

    this.transactionProviderIndex.set(status.id, provider);
    this.queueTransactionReport({
      id: status.id,
      provider: status.provider,
      providerId: status.providerId,
      status: status.status,
      amount: status.amount,
      currency: status.currency,
      latencyMs,
      timestamp: status.updatedAt,
    });
    return status;
  }

  async listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodInfo[]> {
    const methods = await Promise.all(
      this.providerOrder.map(async (provider) => {
        const adapter = this.getAdapter(provider);
        const providerMethods = await this.wrapProviderCall(
          provider,
          'listPaymentMethods',
          () => adapter.listPaymentMethods(country, currency),
        );

        return providerMethods.map((method) => ({
          ...method,
          provider: method.provider || provider,
        }));
      }),
    );

    return methods.flat();
  }

  async handleWebhook(
    provider: string,
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<VaultEvent> {
    const adapter = this.getAdapter(provider);

    if (adapter.handleWebhook) {
      const handler = adapter.handleWebhook;
      const event = await this.wrapProviderCall(provider, 'handleWebhook', () =>
        Promise.resolve(handler.call(adapter, payload, headers)),
      );

      if (event.transactionId) {
        this.transactionProviderIndex.set(event.transactionId, provider);
      }

      this.queueWebhookEvent(event);
      return event;
    }

    const parsedPayload = this.parseWebhookPayload(payload);
    const event = normalizeWebhookEvent(provider, parsedPayload, payload);

    if (event.transactionId) {
      this.transactionProviderIndex.set(event.transactionId, provider);
    }

    this.queueWebhookEvent(event);
    return event;
  }

  private async resolveProviderForCharge(
    request: ChargeRequest,
  ): Promise<ResolvedProvider> {
    if (request.routing?.provider) {
      if (request.routing.exclude?.includes(request.routing.provider)) {
        throw new VaultRoutingError(
          'Forced provider is listed in routing exclusions.',
          {
            code: 'ROUTING_PROVIDER_EXCLUDED',
            context: {
              provider: request.routing.provider,
            },
          },
        );
      }

      this.getAdapter(request.routing.provider);
      return {
        provider: request.routing.provider,
        source: 'local',
        reason: 'forced provider',
      };
    }

    const platformDecision = await this.resolveProviderFromPlatform(request);
    if (platformDecision) {
      return platformDecision;
    }

    const context: RoutingContext = {
      currency: request.currency,
      paymentMethod: request.paymentMethod.type,
      amount: request.amount,
      metadata: request.metadata,
      exclude: request.routing?.exclude,
    };

    const decision = this.router?.decide(context);
    if (decision) {
      this.getAdapter(decision.provider);
      return {
        provider: decision.provider,
        source: 'local',
        reason: decision.reason,
      };
    }

    const fallback = this.providerOrder.find(
      (provider) => !request.routing?.exclude?.includes(provider),
    );
    if (!fallback) {
      throw new VaultRoutingError(
        'No eligible provider found after exclusions.',
      );
    }

    return {
      provider: fallback,
      source: 'local',
      reason: 'fallback provider',
    };
  }

  private async resolveProviderFromPlatform(
    request: ChargeRequest,
  ): Promise<ResolvedProvider | null> {
    if (!this.platformConnector) {
      return null;
    }

    try {
      const decision = await this.platformConnector.decideRouting({
        currency: request.currency,
        country: request.customer?.address?.country,
        amount: request.amount,
        paymentMethod: request.paymentMethod.type,
        cardBin: this.extractCardBin(request),
        metadata: request.metadata,
      });

      if (!decision?.provider) {
        return null;
      }

      if (request.routing?.exclude?.includes(decision.provider)) {
        return null;
      }

      this.getAdapter(decision.provider);
      return {
        provider: decision.provider,
        source: 'platform',
        reason: decision.reason ?? 'platform routing decision',
        decisionId: decision.decisionId,
      };
    } catch (error) {
      this.config.logging?.logger?.warn(
        'Platform routing unavailable. Falling back to local routing.',
        {
          operation: 'resolveProviderForCharge',
          cause: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  private resolveProviderForTransaction(transactionId: string): string {
    const mappedProvider = this.transactionProviderIndex.get(transactionId);
    if (mappedProvider) {
      return mappedProvider;
    }

    const fallbackProvider = this.providerOrder[0];
    if (!fallbackProvider) {
      throw new VaultRoutingError(
        'No configured providers are available for transaction lookup.',
      );
    }

    return fallbackProvider;
  }

  private getAdapter(provider: string): PaymentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new VaultRoutingError('Provider is not configured or enabled.', {
        code: 'ROUTING_PROVIDER_UNAVAILABLE',
        context: {
          provider,
        },
      });
    }

    return adapter;
  }

  private withRouting(
    result: PaymentResult,
    route: ResolvedProvider,
    request?: ChargeRequest,
  ): PaymentResult {
    return {
      ...result,
      provider: result.provider || route.provider,
      metadata: {
        ...(request?.metadata ?? {}),
        ...result.metadata,
      },
      routing: {
        source: route.source,
        reason: route.reason,
      },
      providerMetadata: result.providerMetadata ?? {},
    };
  }

  private parseWebhookPayload(
    payload: Buffer | string,
  ): ProviderWebhookPayload {
    const raw =
      typeof payload === 'string' ? payload : payload.toString('utf-8');

    try {
      const parsed = JSON.parse(raw) as ProviderWebhookPayload;
      return parsed;
    } catch {
      return {
        data: {
          payload: raw,
        },
      };
    }
  }

  private extractCardBin(request: ChargeRequest): string | undefined {
    if (
      request.paymentMethod.type === 'card' &&
      'number' in request.paymentMethod
    ) {
      const digits = request.paymentMethod.number.replace(/\D/g, '');
      if (digits.length >= 6) {
        return digits.slice(0, 6);
      }
    }

    return undefined;
  }

  private queueTransactionReport(report: PlatformTransactionReport): void {
    if (!this.platformConnector) {
      return;
    }

    this.platformConnector.queueTransactionReport(report);
  }

  private queueWebhookEvent(event: VaultEvent): void {
    if (!this.platformConnector) {
      return;
    }

    this.platformConnector.queueWebhookEvent({
      id: event.id,
      type: event.type,
      provider: event.provider,
      transactionId: event.transactionId,
      providerEventId: event.providerEventId,
      data: event.data,
      timestamp: event.timestamp,
    });
  }

  private async executeIdempotentOperation<
    TRequest extends IdempotentRequest,
    TResult,
  >(
    operation: string,
    request: TRequest,
    execute: () => Promise<TResult>,
  ): Promise<TResult> {
    const key = request.idempotencyKey;
    if (!key) {
      return execute();
    }

    await this.idempotencyStore.clearExpired();

    const payloadHash = hashIdempotencyPayload({
      operation,
      request,
    });
    const existingRecord = await this.idempotencyStore.get(key);

    if (existingRecord) {
      if (existingRecord.payloadHash !== payloadHash) {
        throw new VaultIdempotencyConflictError(
          'Idempotency key was reused with a different payload.',
          {
            operation,
            key,
          },
        );
      }

      return existingRecord.result as TResult;
    }

    const result = await execute();

    await this.idempotencyStore.set({
      key,
      payloadHash,
      result,
      expiresAt: Date.now() + this.idempotencyTtlMs,
    });

    return result;
  }

  private async wrapProviderCall<T>(
    provider: string,
    operation: string,
    execute: () => Promise<T>,
  ): Promise<T> {
    try {
      return await execute();
    } catch (error) {
      if (error instanceof VaultError) {
        throw error;
      }

      throw mapProviderError(error, {
        provider,
        operation,
      });
    }
  }
}
