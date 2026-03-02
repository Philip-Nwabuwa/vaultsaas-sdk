export type { VaultErrorCategory } from './error-categories';
export {
  buildVaultErrorDocsUrl,
  getVaultErrorCodeDefinition,
  VAULT_ERROR_CODE_DEFINITIONS,
} from './error-codes';
export {
  isProviderErrorHint,
  mapProviderError,
} from './provider-error-mapper';
export type {
  ProviderErrorHint,
  ProviderErrorMappingContext,
} from './provider-error-mapper';
export {
  VaultConfigError,
  VaultError,
  type VaultErrorContext,
  VaultIdempotencyConflictError,
  VaultNetworkError,
  VaultProviderError,
  VaultRoutingError,
  WebhookVerificationError,
} from './vault-error';
