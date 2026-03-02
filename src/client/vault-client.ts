import {
  VaultConfigError,
  VaultProviderError,
  VaultRoutingError,
} from '../errors';
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

interface ResolvedProvider {
  provider: string;
  source: 'local' | 'platform';
  reason: string;
}

export class VaultClient {
  readonly config: VaultConfig;
  private readonly adapters = new Map<string, PaymentAdapter>();
  private readonly providerOrder: string[];
  private readonly router: Router | null;
  private readonly transactionProviderIndex = new Map<string, string>();

  constructor(config: VaultConfig) {
    this.config = config;

    const entries = Object.entries(config.providers ?? {});
    if (entries.length === 0) {
      throw new VaultConfigError('At least one provider must be configured.');
    }

    this.providerOrder = entries
      .filter(([, provider]) => provider.enabled !== false)
      .sort(([, a], [, b]) => (a.priority ?? 0) - (b.priority ?? 0))
      .map(([name, provider]) => {
        if (!provider.adapter) {
          throw new VaultConfigError(
            'Provider adapter constructor is missing.',
            {
              provider: name,
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
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    const route = this.resolveProviderForCharge(request);
    const adapter = this.getAdapter(route.provider);
    const result = await this.wrapProviderCall(route.provider, 'charge', () =>
      adapter.charge(request),
    );

    const normalized = this.withRouting(result, route, request);
    this.transactionProviderIndex.set(normalized.id, route.provider);
    return normalized;
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    const route = this.resolveProviderForCharge(request);
    const adapter = this.getAdapter(route.provider);
    const result = await this.wrapProviderCall(
      route.provider,
      'authorize',
      () => adapter.authorize(request),
    );

    const normalized = this.withRouting(result, route, request);
    this.transactionProviderIndex.set(normalized.id, route.provider);
    return normalized;
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    const provider = this.resolveProviderForTransaction(request.transactionId);
    const adapter = this.getAdapter(provider);
    const result = await this.wrapProviderCall(provider, 'capture', () =>
      adapter.capture(request),
    );

    const normalized = this.withRouting(result, {
      provider,
      source: 'local',
      reason: 'transaction provider lookup',
    });

    this.transactionProviderIndex.set(normalized.id, provider);
    return normalized;
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const provider = this.resolveProviderForTransaction(request.transactionId);
    const adapter = this.getAdapter(provider);

    return this.wrapProviderCall(provider, 'refund', () =>
      adapter.refund(request),
    );
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    const provider = this.resolveProviderForTransaction(request.transactionId);
    const adapter = this.getAdapter(provider);

    return this.wrapProviderCall(provider, 'void', () => adapter.void(request));
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    const provider = this.resolveProviderForTransaction(transactionId);
    const adapter = this.getAdapter(provider);
    const status = await this.wrapProviderCall(provider, 'getStatus', () =>
      adapter.getStatus(transactionId),
    );

    this.transactionProviderIndex.set(status.id, provider);
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

      return event;
    }

    const parsedPayload = this.parseWebhookPayload(payload);
    const event = normalizeWebhookEvent(provider, parsedPayload, payload);

    if (event.transactionId) {
      this.transactionProviderIndex.set(event.transactionId, provider);
    }

    return event;
  }

  private resolveProviderForCharge(request: ChargeRequest): ResolvedProvider {
    if (request.routing?.provider) {
      if (request.routing.exclude?.includes(request.routing.provider)) {
        throw new VaultRoutingError(
          'Forced provider is listed in routing exclusions.',
          {
            provider: request.routing.provider,
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
        provider,
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

  private async wrapProviderCall<T>(
    provider: string,
    operation: string,
    execute: () => Promise<T>,
  ): Promise<T> {
    try {
      return await execute();
    } catch (error) {
      if (
        error instanceof VaultConfigError ||
        error instanceof VaultRoutingError ||
        error instanceof VaultProviderError
      ) {
        throw error;
      }

      throw new VaultProviderError('Provider operation failed.', {
        provider,
        operation,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
