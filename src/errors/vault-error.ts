import type { VaultErrorCategory } from './error-categories';
import {
  buildVaultErrorDocsUrl,
  getVaultErrorCodeDefinition,
} from './error-codes';

export interface VaultErrorContext {
  provider?: string;
  operation?: string;
  requestId?: string;
  providerCode?: string;
  providerMessage?: string;
  [key: string]: unknown;
}

export interface VaultErrorOptions {
  code: string;
  category?: VaultErrorCategory;
  suggestion?: string;
  docsUrl?: string;
  retriable?: boolean;
  context?: VaultErrorContext;
}

export class VaultError extends Error {
  readonly code: string;
  readonly category: VaultErrorCategory;
  readonly suggestion: string;
  readonly docsUrl: string;
  readonly retriable: boolean;
  readonly context: VaultErrorContext;

  constructor(message: string, options: VaultErrorOptions) {
    super(message);
    const definition = getVaultErrorCodeDefinition(options.code);

    this.name = 'VaultError';
    this.code = options.code;
    this.category = options.category ?? definition.category;
    this.suggestion = options.suggestion ?? definition.suggestion;
    this.docsUrl =
      options.docsUrl ??
      buildVaultErrorDocsUrl(options.code, definition.docsPath);
    this.retriable = options.retriable ?? definition.retriable;
    this.context = options.context ?? {};

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface VaultSubclassOptions extends Omit<VaultErrorOptions, 'code'> {
  code?: string;
}

const SUBCLASS_OPTION_KEYS = [
  'code',
  'category',
  'suggestion',
  'docsUrl',
  'retriable',
  'context',
] as const;

function isSubclassOptions(value: unknown): value is VaultSubclassOptions {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return SUBCLASS_OPTION_KEYS.some((key) => key in record);
}

function normalizeSubclassOptions(
  value?: VaultErrorContext | VaultSubclassOptions,
): VaultSubclassOptions {
  if (isSubclassOptions(value)) {
    return value;
  }

  return value ? { context: value } : {};
}

export class VaultConfigError extends VaultError {
  constructor(
    message: string,
    options?: VaultErrorContext | VaultSubclassOptions,
  ) {
    const normalized = normalizeSubclassOptions(options);

    super(message, {
      code: normalized.code ?? 'INVALID_CONFIGURATION',
      category: normalized.category,
      suggestion: normalized.suggestion,
      docsUrl: normalized.docsUrl,
      retriable: normalized.retriable,
      context: normalized.context,
    });
    this.name = 'VaultConfigError';
  }
}

export class VaultRoutingError extends VaultError {
  constructor(
    message: string,
    options?: VaultErrorContext | VaultSubclassOptions,
  ) {
    const normalized = normalizeSubclassOptions(options);

    super(message, {
      code: normalized.code ?? 'NO_ROUTING_MATCH',
      category: normalized.category,
      suggestion: normalized.suggestion,
      docsUrl: normalized.docsUrl,
      retriable: normalized.retriable,
      context: normalized.context,
    });
    this.name = 'VaultRoutingError';
  }
}

export class VaultProviderError extends VaultError {
  constructor(
    message: string,
    options?: VaultErrorContext | VaultSubclassOptions,
  ) {
    const normalized = normalizeSubclassOptions(options);

    super(message, {
      code: normalized.code ?? 'PROVIDER_ERROR',
      category: normalized.category,
      suggestion: normalized.suggestion,
      docsUrl: normalized.docsUrl,
      retriable: normalized.retriable,
      context: normalized.context,
    });
    this.name = 'VaultProviderError';
  }
}

export class VaultNetworkError extends VaultError {
  constructor(
    message: string,
    options?: VaultErrorContext | VaultSubclassOptions,
  ) {
    const normalized = normalizeSubclassOptions(options);

    super(message, {
      code: normalized.code ?? 'NETWORK_ERROR',
      category: normalized.category,
      suggestion: normalized.suggestion,
      docsUrl: normalized.docsUrl,
      retriable: normalized.retriable ?? true,
      context: normalized.context,
    });
    this.name = 'VaultNetworkError';
  }
}

export class WebhookVerificationError extends VaultError {
  constructor(
    message: string,
    options?: VaultErrorContext | VaultSubclassOptions,
  ) {
    const normalized = normalizeSubclassOptions(options);

    super(message, {
      code: normalized.code ?? 'WEBHOOK_SIGNATURE_INVALID',
      category: normalized.category,
      suggestion: normalized.suggestion,
      docsUrl: normalized.docsUrl,
      retriable: normalized.retriable,
      context: normalized.context,
    });
    this.name = 'WebhookVerificationError';
  }
}

export class VaultIdempotencyConflictError extends VaultError {
  constructor(
    message: string,
    options?: VaultErrorContext | VaultSubclassOptions,
  ) {
    const normalized = normalizeSubclassOptions(options);

    super(message, {
      code: normalized.code ?? 'IDEMPOTENCY_CONFLICT',
      category: normalized.category,
      suggestion: normalized.suggestion,
      docsUrl: normalized.docsUrl,
      retriable: normalized.retriable,
      context: normalized.context,
    });
    this.name = 'VaultIdempotencyConflictError';
  }
}
