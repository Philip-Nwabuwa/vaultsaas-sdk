import type { RoutingContext, RoutingDecision, RoutingRule } from '../types';
import { ruleMatchesContext } from './rule-evaluator';

export class Router {
  readonly rules: RoutingRule[];

  constructor(rules: RoutingRule[]) {
    this.rules = [...rules];
  }

  decide(context: RoutingContext): RoutingDecision | null {
    if (context.providerOverride) {
      return {
        provider: context.providerOverride,
        reason: 'provider override',
        rule: {
          provider: context.providerOverride,
          match: {
            default: true,
          },
        },
      };
    }

    for (const rule of this.rules) {
      if (context.exclude?.includes(rule.provider)) {
        continue;
      }

      if (!ruleMatchesContext(rule, context)) {
        continue;
      }

      return {
        provider: rule.provider,
        reason: rule.match.default ? 'default rule' : 'matched rule',
        rule,
      };
    }

    return null;
  }
}
