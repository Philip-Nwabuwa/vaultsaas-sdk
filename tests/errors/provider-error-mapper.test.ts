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
});
