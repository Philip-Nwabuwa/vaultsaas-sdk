import type { RoutingRule } from './routing';

export interface ProviderConfig {
  name: string;
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface IdempotencyConfig {
  enabled?: boolean;
  ttlMs?: number;
}

export interface LoggingConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  redactKeys?: string[];
}

export interface VaultConfig {
  providers: ProviderConfig[];
  routingRules?: RoutingRule[];
  defaultProvider?: string;
  idempotency?: IdempotencyConfig;
  logging?: LoggingConfig;
  platformApiKey?: string;
  platformBaseUrl?: string;
  requestTimeoutMs?: number;
}
