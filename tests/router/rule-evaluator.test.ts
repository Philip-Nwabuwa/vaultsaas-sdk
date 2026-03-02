import { describe, expect, it } from 'vitest';
import { ruleMatchesContext } from '../../src/router';
import type { RoutingRule } from '../../src/types';

describe('ruleMatchesContext', () => {
  it('matches exact currency, country, and payment method', () => {
    const rule: RoutingRule = {
      provider: 'dlocal',
      match: {
        currency: 'BRL',
        country: 'BR',
        paymentMethod: 'card',
      },
    };

    const result = ruleMatchesContext(rule, {
      currency: 'BRL',
      country: 'BR',
      paymentMethod: 'card',
    });

    expect(result).toBe(true);
  });

  it('supports array match values', () => {
    const rule: RoutingRule = {
      provider: 'stripe',
      match: {
        currency: ['USD', 'EUR'],
        country: ['US', 'CA'],
      },
    };

    expect(
      ruleMatchesContext(rule, {
        currency: 'USD',
        country: 'CA',
      }),
    ).toBe(true);

    expect(
      ruleMatchesContext(rule, {
        currency: 'BRL',
        country: 'CA',
      }),
    ).toBe(false);
  });

  it('matches amount ranges and metadata filters', () => {
    const rule: RoutingRule = {
      provider: 'paystack',
      match: {
        amountMin: 100,
        amountMax: 500,
        metadata: {
          merchantCategory: 'ecommerce',
        },
      },
    };

    expect(
      ruleMatchesContext(rule, {
        amount: 250,
        metadata: {
          merchantCategory: 'ecommerce',
        },
      }),
    ).toBe(true);

    expect(
      ruleMatchesContext(rule, {
        amount: 50,
        metadata: {
          merchantCategory: 'ecommerce',
        },
      }),
    ).toBe(false);

    expect(
      ruleMatchesContext(rule, {
        amount: 250,
        metadata: {
          merchantCategory: 'retail',
        },
      }),
    ).toBe(false);
  });

  it('always matches default rules', () => {
    const rule: RoutingRule = {
      provider: 'stripe',
      match: {
        default: true,
      },
    };

    expect(ruleMatchesContext(rule, {})).toBe(true);
  });
});
