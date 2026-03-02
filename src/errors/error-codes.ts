import type { VaultErrorCategory } from './error-categories';

const ERROR_DOCS_BASE_URL = 'https://docs.vaultsaas.com/errors';

export interface VaultErrorCodeDefinition {
  category: VaultErrorCategory;
  suggestion: string;
  retriable: boolean;
  docsPath?: string;
}

const FALLBACK_CODE_DEFINITION: VaultErrorCodeDefinition = {
  category: 'unknown',
  suggestion:
    'Review provider response details and retry only when the failure is transient.',
  retriable: false,
};

export const VAULT_ERROR_CODE_DEFINITIONS: Record<
  string,
  VaultErrorCodeDefinition
> = {
  INVALID_CONFIGURATION: {
    category: 'configuration_error',
    suggestion:
      'Check VaultClient configuration values and required provider settings.',
    retriable: false,
  },
  PROVIDER_NOT_CONFIGURED: {
    category: 'configuration_error',
    suggestion:
      'Add the provider adapter and credentials to VaultClient.providers.',
    retriable: false,
  },
  ADAPTER_NOT_FOUND: {
    category: 'configuration_error',
    suggestion: 'Install the provider adapter package and wire it in config.',
    retriable: false,
  },
  PROVIDER_AUTH_FAILED: {
    category: 'configuration_error',
    suggestion:
      'Verify provider credentials and ensure they match the current environment.',
    retriable: false,
  },
  NO_ROUTING_MATCH: {
    category: 'routing_error',
    suggestion:
      'Add a matching routing rule or configure a default fallback provider.',
    retriable: false,
  },
  ROUTING_PROVIDER_EXCLUDED: {
    category: 'routing_error',
    suggestion:
      'Remove the forced provider from exclusions or choose a different provider override.',
    retriable: false,
  },
  ROUTING_PROVIDER_UNAVAILABLE: {
    category: 'routing_error',
    suggestion:
      'Enable the provider in config or update routing rules to a valid provider.',
    retriable: false,
  },
  INVALID_REQUEST: {
    category: 'invalid_request',
    suggestion:
      'Fix invalid or missing request fields before retrying the operation.',
    retriable: false,
  },
  IDEMPOTENCY_CONFLICT: {
    category: 'invalid_request',
    suggestion:
      'Reuse the same payload for an idempotency key or generate a new key.',
    retriable: false,
  },
  WEBHOOK_SIGNATURE_INVALID: {
    category: 'invalid_request',
    suggestion:
      'Verify webhook secret, signature algorithm, and that the raw body is unmodified.',
    retriable: false,
  },
  CARD_DECLINED: {
    category: 'card_declined',
    suggestion:
      'Ask the customer for another payment method or a retry with updated details.',
    retriable: false,
  },
  AUTHENTICATION_REQUIRED: {
    category: 'authentication_required',
    suggestion:
      'Trigger customer authentication (for example, a 3DS challenge).',
    retriable: false,
  },
  FRAUD_SUSPECTED: {
    category: 'fraud_suspected',
    suggestion:
      'Block automatic retries and route the payment through manual fraud review.',
    retriable: false,
  },
  RATE_LIMITED: {
    category: 'rate_limited',
    suggestion: 'Apply exponential backoff before retrying provider requests.',
    retriable: true,
  },
  NETWORK_ERROR: {
    category: 'network_error',
    suggestion:
      'Retry with backoff and confirm outbound connectivity/timeouts to the provider.',
    retriable: true,
  },
  PROVIDER_TIMEOUT: {
    category: 'network_error',
    suggestion:
      'Retry with backoff and increase timeout if the provider latency is expected.',
    retriable: true,
  },
  PLATFORM_UNREACHABLE: {
    category: 'network_error',
    suggestion:
      'Use local routing fallback and verify platform API key and network reachability.',
    retriable: true,
  },
  PROVIDER_ERROR: {
    category: 'provider_error',
    suggestion:
      'Retry if transient, or fail over to another provider when configured.',
    retriable: true,
  },
  PROVIDER_UNKNOWN: {
    category: 'unknown',
    suggestion:
      'Capture provider response metadata and map this error case for deterministic handling.',
    retriable: false,
  },
};

export function getVaultErrorCodeDefinition(
  code: string,
): VaultErrorCodeDefinition {
  return VAULT_ERROR_CODE_DEFINITIONS[code] ?? FALLBACK_CODE_DEFINITION;
}

export function buildVaultErrorDocsUrl(
  code: string,
  docsPath?: string,
): string {
  const path = docsPath ?? code.toLowerCase();
  return `${ERROR_DOCS_BASE_URL}/${path}`;
}
