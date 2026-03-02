import { VaultNetworkError } from '../errors';
import type { LoggerInterface } from '../types';
import { BatchBuffer } from './buffer';

/** Platform telemetry and routing client configuration. */
export interface PlatformConnectorConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  logger?: LoggerInterface;
  fetchFn?: typeof fetch;
}

interface ResolvedPlatformConnectorConfig extends PlatformConnectorConfig {
  baseUrl: string;
  timeoutMs: number;
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  initialBackoffMs: number;
}

export interface PlatformRoutingRequest {
  currency: string;
  amount: number;
  paymentMethod: string;
  country?: string;
  cardBin?: string;
  metadata?: Record<string, string>;
}

/** Response shape for remote routing decisions. */
export interface PlatformRoutingDecision {
  provider: string | null;
  source?: string;
  reason?: string;
  decisionId?: string;
  ttlMs?: number;
  cascade?: string[];
}

/** Transaction telemetry event sent to the VaultSaaS platform. */
export interface PlatformTransactionReport {
  id: string;
  provider: string;
  providerId?: string;
  status: string;
  amount: number;
  currency: string;
  country?: string;
  paymentMethod?: string;
  cardBin?: string;
  cardBrand?: string;
  latencyMs?: number;
  errorCategory?: string | null;
  routingSource?: 'local' | 'platform';
  routingDecisionId?: string;
  idempotencyKey?: string;
  timestamp: string;
}

/** Webhook forwarding payload sent to the VaultSaaS platform. */
export interface PlatformWebhookForwardEvent {
  id: string;
  type: string;
  provider: string;
  transactionId?: string;
  providerEventId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/** Batches platform routing/telemetry requests with retry and timeout controls. */
export class PlatformConnector {
  private static readonly DEFAULT_BASE_URL = 'https://api.vaultsaas.com';
  private static readonly DEFAULT_TIMEOUT_MS = 75;
  private static readonly DEFAULT_BATCH_SIZE = 50;
  private static readonly DEFAULT_FLUSH_INTERVAL_MS = 2000;
  private static readonly DEFAULT_MAX_RETRIES = 2;
  private static readonly DEFAULT_INITIAL_BACKOFF_MS = 100;

  readonly config: ResolvedPlatformConnectorConfig;
  readonly transactionBuffer: BatchBuffer<PlatformTransactionReport>;
  readonly webhookBuffer: BatchBuffer<PlatformWebhookForwardEvent>;

  private readonly fetchFn: typeof fetch;
  private readonly logger?: LoggerInterface;
  private readonly flushTimer: ReturnType<typeof setInterval>;
  private transactionSendQueue: Promise<void> = Promise.resolve();
  private webhookSendQueue: Promise<void> = Promise.resolve();

  constructor(config: PlatformConnectorConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl ?? PlatformConnector.DEFAULT_BASE_URL,
      timeoutMs: config.timeoutMs ?? PlatformConnector.DEFAULT_TIMEOUT_MS,
      batchSize: config.batchSize ?? PlatformConnector.DEFAULT_BATCH_SIZE,
      flushIntervalMs:
        config.flushIntervalMs ?? PlatformConnector.DEFAULT_FLUSH_INTERVAL_MS,
      maxRetries: config.maxRetries ?? PlatformConnector.DEFAULT_MAX_RETRIES,
      initialBackoffMs:
        config.initialBackoffMs ?? PlatformConnector.DEFAULT_INITIAL_BACKOFF_MS,
    };
    this.fetchFn = config.fetchFn ?? fetch;
    this.logger = config.logger;
    this.transactionBuffer = new BatchBuffer(this.config.batchSize);
    this.webhookBuffer = new BatchBuffer(this.config.batchSize);
    this.flushTimer = setInterval(() => {
      void this.flush().catch((error) => {
        this.warn('Platform connector periodic flush failed.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.config.flushIntervalMs);

    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  close(): void {
    clearInterval(this.flushTimer);
  }

  async decideRouting(
    request: PlatformRoutingRequest,
  ): Promise<PlatformRoutingDecision | null> {
    try {
      const response = await this.postJson<PlatformRoutingRequest, unknown>({
        path: '/v1/routing/decide',
        body: request,
        timeoutMs: this.config.timeoutMs,
        maxRetries: 0,
      });
      const decision = this.normalizeRoutingDecision(response);
      if (!decision) {
        return null;
      }

      return decision.provider ? decision : null;
    } catch (error) {
      throw new VaultNetworkError('Platform routing decision failed.', {
        code: 'PLATFORM_UNREACHABLE',
        context: {
          endpoint: '/v1/routing/decide',
          operation: 'decideRouting',
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  queueTransactionReport(transaction: PlatformTransactionReport): void {
    const batch = this.transactionBuffer.push(transaction);
    if (!batch) {
      return;
    }

    this.enqueueTransactionBatch(batch);
  }

  queueWebhookEvent(event: PlatformWebhookForwardEvent): void {
    const batch = this.webhookBuffer.push(event);
    if (!batch) {
      return;
    }

    this.enqueueWebhookBatch(batch);
  }

  async flush(): Promise<void> {
    const pendingTransactions = this.transactionBuffer.flush();
    if (pendingTransactions.length > 0) {
      this.enqueueTransactionBatch(pendingTransactions);
    }

    const pendingWebhookEvents = this.webhookBuffer.flush();
    if (pendingWebhookEvents.length > 0) {
      this.enqueueWebhookBatch(pendingWebhookEvents);
    }

    await Promise.all([this.transactionSendQueue, this.webhookSendQueue]);
  }

  private enqueueTransactionBatch(batch: PlatformTransactionReport[]): void {
    this.transactionSendQueue = this.transactionSendQueue.then(async () => {
      try {
        await this.postJson({
          path: '/v1/transactions/report',
          body: { transactions: batch },
        });
      } catch (error) {
        this.warn('Failed to report transactions batch to platform.', {
          endpoint: '/v1/transactions/report',
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private enqueueWebhookBatch(batch: PlatformWebhookForwardEvent[]): void {
    this.webhookSendQueue = this.webhookSendQueue.then(async () => {
      try {
        await this.postJson({
          path: '/v1/events/webhook',
          body: { events: batch },
        });
      } catch (error) {
        this.warn('Failed to forward webhook batch to platform.', {
          endpoint: '/v1/events/webhook',
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private async postJson<TBody, TResult>(options: {
    path: string;
    body: TBody;
    timeoutMs?: number;
    maxRetries?: number;
  }): Promise<TResult> {
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;

    let attempt = 0;
    while (attempt <= maxRetries) {
      attempt += 1;
      try {
        const response = await this.fetchWithTimeout(options.path, {
          method: 'POST',
          body: JSON.stringify(options.body),
          timeoutMs,
        });

        if (!response.ok) {
          if (
            attempt <= maxRetries &&
            (response.status >= 500 || response.status === 429)
          ) {
            await this.delay(this.backoffForAttempt(attempt));
            continue;
          }

          throw new Error(`platform status ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return (await response.json()) as TResult;
        }

        return {} as TResult;
      } catch (error) {
        if (attempt > maxRetries) {
          throw error;
        }

        this.debug('Retrying platform request after failure.', {
          endpoint: options.path,
          attempt,
          maxRetries,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.delay(this.backoffForAttempt(attempt));
      }
    }

    throw new Error('Platform request exhausted retries.');
  }

  private async fetchWithTimeout(
    path: string,
    options: {
      method: string;
      body: string;
      timeoutMs: number;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, options.timeoutMs);

    try {
      const response = await this.fetchFn(this.urlFor(path), {
        method: options.method,
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: options.body,
        signal: controller.signal,
      });

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeRoutingDecision(
    input: unknown,
  ): PlatformRoutingDecision | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }

    const data = input as Record<string, unknown>;
    return {
      provider:
        typeof data.provider === 'string' ? data.provider : (null as null),
      source: typeof data.source === 'string' ? data.source : undefined,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
      decisionId:
        typeof data.decisionId === 'string' ? data.decisionId : undefined,
      ttlMs: typeof data.ttlMs === 'number' ? data.ttlMs : undefined,
      cascade: Array.isArray(data.cascade)
        ? data.cascade.filter(
            (value): value is string => typeof value === 'string',
          )
        : undefined,
    };
  }

  private backoffForAttempt(attempt: number): number {
    return this.config.initialBackoffMs * 2 ** (attempt - 1);
  }

  private urlFor(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private debug(message: string, context?: Record<string, unknown>): void {
    this.logger?.debug(message, context);
  }

  private warn(message: string, context?: Record<string, unknown>): void {
    this.logger?.warn(message, context);
  }
}
