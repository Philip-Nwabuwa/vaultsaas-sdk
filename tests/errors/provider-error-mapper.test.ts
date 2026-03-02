import { describe, expect, it } from 'vitest';
import {
  VaultNetworkError,
  VaultProviderError,
  VaultRoutingError,
  isProviderErrorHint,
  mapProviderError,
} from '../../src/errors';

describe('provider error mapper', () => {
  it('returns VaultError instances unchanged', () => {
    const source = new VaultRoutingError('No routing match.');
    const mapped = mapProviderError(source, {
      provider: 'stripe',
      operation: 'charge',
    });

    expect(mapped).toBe(source);
  });

  it('maps network timeout errors to VaultNetworkError', () => {
    const timeout = new Error('socket timed out') as Error & { code: string };
    timeout.code = 'ETIMEDOUT';

    const mapped = mapProviderError(timeout, {
      provider: 'stripe',
      operation: 'charge',
    });

    expect(mapped).toBeInstanceOf(VaultNetworkError);
    expect(mapped.code).toBe('PROVIDER_TIMEOUT');
    expect(mapped.category).toBe('network_error');
    expect(mapped.retriable).toBe(true);
  });

  it('maps HTTP 401 errors to configuration_error', () => {
    const mapped = mapProviderError(
      {
        message: 'Unauthorized',
        status: 401,
        providerCode: 'auth_failed',
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped).toBeInstanceOf(VaultProviderError);
    expect(mapped.code).toBe('PROVIDER_AUTH_FAILED');
    expect(mapped.category).toBe('configuration_error');
    expect(mapped.retriable).toBe(false);
  });

  it('maps HTTP 429 errors as rate_limited', () => {
    const mapped = mapProviderError(
      {
        message: 'Too many requests',
        status: 429,
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('RATE_LIMITED');
    expect(mapped.category).toBe('rate_limited');
    expect(mapped.retriable).toBe(true);
  });

  it('maps decline messages to card_declined', () => {
    const mapped = mapProviderError(
      {
        message: 'Card declined: insufficient funds',
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('CARD_DECLINED');
    expect(mapped.category).toBe('card_declined');
    expect(mapped.retriable).toBe(false);
  });

  it('uses provider hint fields over generic error shape', () => {
    const mapped = mapProviderError(
      {
        message: 'Provider failed',
        hint: {
          httpStatus: 429,
          providerCode: 'slow_down',
        },
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('RATE_LIMITED');
    expect(mapped.category).toBe('rate_limited');
    expect(mapped.context.providerCode).toBe('slow_down');
  });

  it('falls back to unknown classification when no signal is available', () => {
    const mapped = mapProviderError(
      {
        message: 'Unexpected downstream response',
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('PROVIDER_UNKNOWN');
    expect(mapped.category).toBe('unknown');
  });

  it('maps authentication-required patterns to AUTHENTICATION_REQUIRED', () => {
    const mapped = mapProviderError(
      {
        message: 'Payment requires_action with 3DS challenge required',
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('AUTHENTICATION_REQUIRED');
    expect(mapped.category).toBe('authentication_required');
    expect(mapped.retriable).toBe(false);
  });

  it('maps fraud patterns to FRAUD_SUSPECTED', () => {
    const mapped = mapProviderError(
      {
        message: 'Transaction blocked for risk check due to suspected fraud',
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('FRAUD_SUSPECTED');
    expect(mapped.category).toBe('fraud_suspected');
    expect(mapped.retriable).toBe(false);
  });

  it('maps invalid request patterns to INVALID_REQUEST', () => {
    const mapped = mapProviderError(
      {
        message: 'Validation failed: missing required parameter',
      },
      {
        provider: 'stripe',
        operation: 'refund',
      },
    );

    expect(mapped.code).toBe('INVALID_REQUEST');
    expect(mapped.category).toBe('invalid_request');
    expect(mapped.retriable).toBe(false);
  });

  it('maps HTTP 500 errors to PROVIDER_ERROR', () => {
    const mapped = mapProviderError(
      {
        message: 'Upstream unavailable',
        status: 500,
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('PROVIDER_ERROR');
    expect(mapped.category).toBe('provider_error');
    expect(mapped.retriable).toBe(true);
  });

  it('maps statusCode-based errors when status is absent', () => {
    const mapped = mapProviderError(
      {
        message: 'Forbidden',
        statusCode: 403,
      },
      {
        provider: 'paystack',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('PROVIDER_AUTH_FAILED');
    expect(mapped.category).toBe('configuration_error');
  });

  it('maps network code ECONNREFUSED to NETWORK_ERROR', () => {
    const error = new Error('connection refused') as Error & { code: string };
    error.code = 'ECONNREFUSED';

    const mapped = mapProviderError(error, {
      provider: 'dlocal',
      operation: 'charge',
    });

    expect(mapped).toBeInstanceOf(VaultNetworkError);
    expect(mapped.code).toBe('NETWORK_ERROR');
    expect(mapped.retriable).toBe(true);
  });

  it('extracts provider details from nested response payloads', () => {
    const mapped = mapProviderError(
      {
        response: {
          status: 402,
          requestId: 'req_nested_1',
          data: {
            error: {
              code: 'card_declined',
              message: 'Card declined by issuer',
              declineCode: 'insufficient_funds',
              type: 'card_error',
            },
          },
        },
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('CARD_DECLINED');
    expect(mapped.context.requestId).toBe('req_nested_1');
    expect(mapped.context.providerCode).toBe('card_declined');
    expect(mapped.context.declineCode).toBe('insufficient_funds');
  });

  it('prefers explicit hint fields over nested payload details', () => {
    const mapped = mapProviderError(
      {
        response: {
          status: 500,
          data: {
            error: {
              code: 'internal_error',
              message: 'Internal server error',
            },
          },
        },
        hint: {
          httpStatus: 429,
          providerCode: 'slow_down',
          providerMessage: 'Rate limited by provider',
          requestId: 'req_hint_1',
        },
      },
      {
        provider: 'stripe',
        operation: 'charge',
      },
    );

    expect(mapped.code).toBe('RATE_LIMITED');
    expect(mapped.context.providerCode).toBe('slow_down');
    expect(mapped.context.requestId).toBe('req_hint_1');
  });
});

describe('isProviderErrorHint', () => {
  it('accepts valid hint objects', () => {
    expect(
      isProviderErrorHint({
        providerCode: 'card_declined',
        providerMessage: 'Card declined.',
        httpStatus: 402,
      }),
    ).toBe(true);
  });

  it('rejects unrelated objects', () => {
    expect(isProviderErrorHint({ foo: 'bar' })).toBe(false);
    expect(isProviderErrorHint('not-an-object')).toBe(false);
  });

  it('accepts raw-only hint payloads', () => {
    expect(
      isProviderErrorHint({
        raw: { reason: 'provider payload' },
      }),
    ).toBe(true);
  });
});
