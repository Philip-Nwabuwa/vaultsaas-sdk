import type { IdempotencyStore } from '../idempotency';
import type { PaymentAdapterConstructor } from './adapter';
import type { RoutingRule } from './routing';

/** Logger contract used by `VaultClient` and `PlatformConnector`. */
export interface LoggerInterface {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/** Config for a single provider adapter instance. */
export interface ProviderConfig {
  adapter: PaymentAdapterConstructor;
  config: Record<string, unknown>;
  priority?: number;
  enabled?: boolean;
}

/** Root configuration object accepted by `new VaultClient(config)`. */
export interface VaultConfig {
  providers: Record<string, ProviderConfig>;
  routing?: {
    rules: RoutingRule[];
  };
  idempotency?: {
    store?: IdempotencyStore;
    ttlMs?: number;
  };
  platformApiKey?: string;
  platform?: {
    baseUrl?: string;
    timeoutMs?: number;
    batchSize?: number;
    flushIntervalMs?: number;
    maxRetries?: number;
    initialBackoffMs?: number;
  };
  logging?: {
    level?: 'silent' | 'error' | 'warn' | 'info' | 'debug';
    logger?: LoggerInterface;
  };
  timeout?: number;
}
