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

  it('returns null when provider override is explicitly excluded', () => {
    const router = new Router(createRules());

    const decision = router.decide({
      providerOverride: 'paystack',
      exclude: ['paystack'],
    });

    expect(decision).toBeNull();
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

  it('falls back to the last weighted candidate when random returns 1', () => {
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

    const router = new Router(rules, {
      random: () => 1,
    });

    const decision = router.decide({ country: 'BR' });

    expect(decision?.provider).toBe('stripe');
    expect(decision?.reason).toContain('weighted selection');
  });

  it('uses generic reason text when a non-default rule has no criteria', () => {
    const rules: RoutingRule[] = [
      {
        provider: 'stripe',
        match: {},
      },
      {
        provider: 'stripe',
        match: {
          default: true,
        },
      },
    ];
    const router = new Router(rules);

    const decision = router.decide({});

    expect(decision?.provider).toBe('stripe');
    expect(decision?.reason).toBe('rule matched at index 0');
  });

  it('returns null when every matching provider is excluded', () => {
    const router = new Router(createRules());

    const decision = router.decide({
      country: 'BR',
      currency: 'USD',
      exclude: ['dlocal', 'stripe'],
    });

    expect(decision).toBeNull();
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
