import { describe, expect, it } from 'vitest';
import {
  VaultConfigError,
  VaultIdempotencyConflictError,
  VaultNetworkError,
  VaultProviderError,
} from '../../src/errors';

describe('VaultError subclasses', () => {
  it('applies canonical config defaults', () => {
    const error = new VaultConfigError('Invalid client configuration.');

    expect(error.code).toBe('INVALID_CONFIGURATION');
    expect(error.category).toBe('configuration_error');
    expect(error.retriable).toBe(false);
    expect(error.suggestion).toContain('configuration values');
    expect(error.docsUrl).toContain('/invalid_configuration');
    expect(error.context).toEqual({});
  });

  it('marks network errors as retriable by default', () => {
    const error = new VaultNetworkError('Provider timeout.', {
      context: {
        provider: 'stripe',
        operation: 'charge',
      },
    });

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.category).toBe('network_error');
    expect(error.retriable).toBe(true);
    expect(error.context.provider).toBe('stripe');
    expect(error.context.operation).toBe('charge');
  });

  it('derives category and suggestion from the canonical error code map', () => {
    const error = new VaultProviderError('Provider rejected credentials.', {
      code: 'PROVIDER_AUTH_FAILED',
      context: {
        provider: 'stripe',
      },
    });

    expect(error.category).toBe('configuration_error');
    expect(error.retriable).toBe(false);
    expect(error.suggestion).toContain('Verify provider credentials');
    expect(error.docsUrl).toContain('/provider_auth_failed');
  });

  it('maps idempotency conflict to invalid_request category', () => {
    const error = new VaultIdempotencyConflictError(
      'Conflict for idempotency.',
    );

    expect(error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(error.category).toBe('invalid_request');
    expect(error.retriable).toBe(false);
  });
});
