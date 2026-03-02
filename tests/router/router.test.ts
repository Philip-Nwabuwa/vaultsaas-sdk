import { describe, expect, it } from 'vitest';
import { VaultRoutingError } from '../../src/errors';
import { Router } from '../../src/router';
import type { RoutingContext, RoutingRule } from '../../src/types';

function createRules(): RoutingRule[] {
  return [
    {
      provider: 'dlocal',
      match: {
        country: 'BR',
      },
    },
    {
      provider: 'stripe',
      match: {
        currency: 'USD',
      },
    },
    {
      provider: 'stripe',
      match: {
        default: true,
      },
    },
  ];
}

describe('Router', () => {
  it('applies top-to-bottom matching order', () => {
    const router = new Router(createRules());

    const context: RoutingContext = {
      country: 'BR',
      currency: 'USD',
    };

    const decision = router.decide(context);

    expect(decision?.provider).toBe('dlocal');
    expect(decision?.reason).toContain('index 0');
  });

  it('supports provider override', () => {
    const router = new Router(createRules());

    const decision = router.decide({
      providerOverride: 'paystack',
    });

    expect(decision?.provider).toBe('paystack');
    expect(decision?.reason).toContain('provider override');
  });

  it('supports exclusions and falls back to default rule', () => {
    const router = new Router(createRules());

    const decision = router.decide({
      country: 'BR',
      exclude: ['dlocal'],
    });

    expect(decision?.provider).toBe('stripe');
    expect(decision?.reason).toContain('default fallback rule');
  });

  it('supports weighted selection where weight is defined', () => {
    const rules: RoutingRule[] = [
      {
        provider: 'dlocal',
        weight: 20,
        match: {
          country: 'BR',
        },
      },
      {
        provider: 'stripe',
        weight: 80,
        match: {
          country: 'BR',
        },
      },
      {
        provider: 'stripe',
        match: {
          default: true,
        },
      },
    ];

    const lowRandomRouter = new Router(rules, {
      random: () => 0.05,
    });
    const highRandomRouter = new Router(rules, {
      random: () => 0.95,
    });

    const lowDecision = lowRandomRouter.decide({ country: 'BR' });
    const highDecision = highRandomRouter.decide({ country: 'BR' });

    expect(lowDecision?.provider).toBe('dlocal');
    expect(highDecision?.provider).toBe('stripe');
    expect(highDecision?.reason).toContain('weighted selection');
  });

  it('throws when no default rule exists', () => {
    const rules: RoutingRule[] = [
      {
        provider: 'dlocal',
        match: {
          currency: 'BRL',
        },
      },
    ];

    expect(() => new Router(rules)).toThrow(VaultRoutingError);
    expect(() => new Router(rules)).toThrow(
      'Routing rules must include a default fallback rule.',
    );
  });
});
