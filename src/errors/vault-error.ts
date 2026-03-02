import type { VaultErrorCategory } from './error-categories';

export interface VaultErrorOptions {
  code: string;
  category: VaultErrorCategory;
  suggestion?: string;
  docsUrl?: string;
  retriable?: boolean;
  context?: Record<string, unknown>;
}

export class VaultError extends Error {
  readonly code: string;
  readonly category: VaultErrorCategory;
  readonly suggestion?: string;
  readonly docsUrl?: string;
  readonly retriable: boolean;
  readonly context?: Record<string, unknown>;

  constructor(message: string, options: VaultErrorOptions) {
    super(message);
    this.name = 'VaultError';
    this.code = options.code;
    this.category = options.category;
    this.suggestion = options.suggestion;
    this.docsUrl = options.docsUrl;
    this.retriable = options.retriable ?? false;
    this.context = options.context;
  }
}

export class VaultConfigError extends VaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: 'CONFIG_ERROR',
      category: 'config',
      suggestion:
        'Check VaultClient configuration values and required provider settings.',
      context,
    });
    this.name = 'VaultConfigError';
  }
}

export class VaultRoutingError extends VaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: 'ROUTING_ERROR',
      category: 'routing',
      suggestion: 'Review routing rules and ensure a default fallback exists.',
      context,
    });
    this.name = 'VaultRoutingError';
  }
}

export class VaultProviderError extends VaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: 'PROVIDER_ERROR',
      category: 'provider',
      suggestion:
        'Inspect provider credentials and raw provider error response.',
      context,
    });
    this.name = 'VaultProviderError';
  }
}

export class VaultNetworkError extends VaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: 'NETWORK_ERROR',
      category: 'network',
      suggestion:
        'Retry with backoff and verify network connectivity/timeouts.',
      retriable: true,
      context,
    });
    this.name = 'VaultNetworkError';
  }
}

export class WebhookVerificationError extends VaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: 'WEBHOOK_VERIFICATION_ERROR',
      category: 'webhook',
      suggestion: 'Verify webhook secret, signature algorithm, and headers.',
      context,
    });
    this.name = 'WebhookVerificationError';
  }
}
