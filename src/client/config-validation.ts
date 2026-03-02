import { VaultConfigError } from '../errors';
import type {
  LoggerInterface,
  PaymentAdapterConstructor,
  ProviderConfig,
  RoutingRule,
  VaultConfig,
} from '../types';

const LOG_LEVELS = new Set(['silent', 'error', 'warn', 'info', 'debug']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPositiveFiniteInteger(
  value: number,
  field: string,
  context?: Record<string, unknown>,
): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new VaultConfigError(`${field} must be a positive integer.`, context);
  }
}

function validateProviderConfig(name: string, provider: ProviderConfig): void {
  if (!provider || typeof provider !== 'object') {
    throw new VaultConfigError('Provider configuration must be an object.', {
      provider: name,
    });
  }

  if (typeof provider.adapter !== 'function') {
    throw new VaultConfigError('Provider adapter constructor is missing.', {
      provider: name,
    });
  }

  const adapter =
    provider.adapter as unknown as Partial<PaymentAdapterConstructor>;
  if (!Array.isArray(adapter.supportedMethods)) {
    throw new VaultConfigError(
      'Provider adapter must declare static supportedMethods.',
      {
        provider: name,
      },
    );
  }

  if (!Array.isArray(adapter.supportedCurrencies)) {
    throw new VaultConfigError(
      'Provider adapter must declare static supportedCurrencies.',
      {
        provider: name,
      },
    );
  }

  if (!Array.isArray(adapter.supportedCountries)) {
    throw new VaultConfigError(
      'Provider adapter must declare static supportedCountries.',
      {
        provider: name,
      },
    );
  }

  if (!isPlainObject(provider.config)) {
    throw new VaultConfigError('Provider config must be a plain object.', {
      provider: name,
    });
  }

  if (
    provider.priority !== undefined &&
    (!Number.isFinite(provider.priority) ||
      !Number.isInteger(provider.priority))
  ) {
    throw new VaultConfigError('Provider priority must be an integer.', {
      provider: name,
    });
  }
}

function validateLogger(logger: LoggerInterface): void {
  const methods: Array<keyof LoggerInterface> = [
    'error',
    'warn',
    'info',
    'debug',
  ];

  for (const method of methods) {
    if (typeof logger[method] !== 'function') {
      throw new VaultConfigError('Logger implementation is missing a method.', {
        method,
      });
    }
  }
}

function validateRoutingRules(
  rules: RoutingRule[],
  providers: Record<string, ProviderConfig>,
): void {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new VaultConfigError(
      'Routing rules must include at least one rule when routing is configured.',
    );
  }

  let hasDefaultRule = false;

  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== 'object') {
      throw new VaultConfigError('Routing rule must be an object.', {
        index,
      });
    }

    if (!rule.provider || typeof rule.provider !== 'string') {
      throw new VaultConfigError(
        'Routing rule provider must be a non-empty string.',
        {
          index,
        },
      );
    }

    const provider = providers[rule.provider];
    if (!provider || provider.enabled === false) {
      throw new VaultConfigError(
        'Routing rule provider must reference an enabled configured provider.',
        {
          index,
          provider: rule.provider,
        },
      );
    }

    if (!rule.match || typeof rule.match !== 'object') {
      throw new VaultConfigError(
        'Routing rule match configuration is required.',
        {
          index,
          provider: rule.provider,
        },
      );
    }

    if (rule.match.default) {
      hasDefaultRule = true;
    }

    if (
      rule.match.amountMin !== undefined &&
      (!Number.isFinite(rule.match.amountMin) || rule.match.amountMin < 0)
    ) {
      throw new VaultConfigError(
        'Routing rule amountMin must be a non-negative number.',
        {
          index,
          provider: rule.provider,
        },
      );
    }

    if (
      rule.match.amountMax !== undefined &&
      (!Number.isFinite(rule.match.amountMax) || rule.match.amountMax < 0)
    ) {
      throw new VaultConfigError(
        'Routing rule amountMax must be a non-negative number.',
        {
          index,
          provider: rule.provider,
        },
      );
    }

    if (
      rule.match.amountMin !== undefined &&
      rule.match.amountMax !== undefined &&
      rule.match.amountMin > rule.match.amountMax
    ) {
      throw new VaultConfigError(
        'Routing rule amountMin cannot exceed amountMax.',
        {
          index,
          provider: rule.provider,
        },
      );
    }

    if (
      rule.weight !== undefined &&
      (!Number.isFinite(rule.weight) || rule.weight <= 0)
    ) {
      throw new VaultConfigError(
        'Routing rule weight must be a positive number.',
        {
          index,
          provider: rule.provider,
        },
      );
    }
  }

  if (!hasDefaultRule) {
    throw new VaultConfigError(
      'Routing configuration must include a default fallback rule.',
    );
  }
}

export function validateVaultConfig(config: VaultConfig): void {
  if (!config || typeof config !== 'object') {
    throw new VaultConfigError('VaultClient configuration must be an object.');
  }

  if (!isPlainObject(config.providers)) {
    throw new VaultConfigError('At least one provider must be configured.');
  }

  const providerEntries = Object.entries(config.providers);
  if (providerEntries.length === 0) {
    throw new VaultConfigError('At least one provider must be configured.');
  }

  for (const [name, provider] of providerEntries) {
    validateProviderConfig(name, provider);
  }

  const enabledProviders = providerEntries.filter(
    ([, provider]) => provider.enabled !== false,
  );
  if (enabledProviders.length === 0) {
    throw new VaultConfigError('No enabled providers are available.');
  }

  if (config.routing) {
    validateRoutingRules(config.routing.rules, config.providers);
  }

  if (config.timeout !== undefined) {
    assertPositiveFiniteInteger(config.timeout, 'timeout');
  }

  if (config.idempotency?.ttlMs !== undefined) {
    assertPositiveFiniteInteger(config.idempotency.ttlMs, 'idempotency.ttlMs');
  }

  if (config.idempotency?.store) {
    const store = config.idempotency.store as unknown as {
      get?: unknown;
      set?: unknown;
      delete?: unknown;
      clearExpired?: unknown;
    };
    const requiredMethods = ['get', 'set', 'delete', 'clearExpired'];

    for (const method of requiredMethods) {
      if (typeof store[method as keyof typeof store] !== 'function') {
        throw new VaultConfigError(
          'Idempotency store is missing required methods.',
          {
            method,
          },
        );
      }
    }
  }

  if (
    config.platformApiKey !== undefined &&
    config.platformApiKey.trim() === ''
  ) {
    throw new VaultConfigError('platformApiKey cannot be empty when provided.');
  }

  if (config.platform) {
    if (
      config.platform.baseUrl !== undefined &&
      config.platform.baseUrl.trim() === ''
    ) {
      throw new VaultConfigError(
        'platform.baseUrl cannot be empty when provided.',
      );
    }

    if (config.platform.timeoutMs !== undefined) {
      assertPositiveFiniteInteger(
        config.platform.timeoutMs,
        'platform.timeoutMs',
      );
    }

    if (config.platform.batchSize !== undefined) {
      assertPositiveFiniteInteger(
        config.platform.batchSize,
        'platform.batchSize',
      );
    }

    if (config.platform.flushIntervalMs !== undefined) {
      assertPositiveFiniteInteger(
        config.platform.flushIntervalMs,
        'platform.flushIntervalMs',
      );
    }

    if (config.platform.maxRetries !== undefined) {
      assertPositiveFiniteInteger(
        config.platform.maxRetries,
        'platform.maxRetries',
      );
    }

    if (config.platform.initialBackoffMs !== undefined) {
      assertPositiveFiniteInteger(
        config.platform.initialBackoffMs,
        'platform.initialBackoffMs',
      );
    }
  }

  if (config.logging?.level && !LOG_LEVELS.has(config.logging.level)) {
    throw new VaultConfigError('Invalid logging level configured.', {
      level: config.logging.level,
    });
  }

  if (config.logging?.logger) {
    validateLogger(config.logging.logger);
  }
}
