import type { IdempotencyStore } from '../idempotency';
import type { PaymentAdapter } from './adapter';
import type { RoutingRule } from './routing';

export interface LoggerInterface {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface ProviderConfig {
  adapter: new (config: Record<string, unknown>) => PaymentAdapter;
  config: Record<string, unknown>;
  priority?: number;
  enabled?: boolean;
}

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
