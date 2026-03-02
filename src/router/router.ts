import type { RoutingContext, RoutingDecision, RoutingRule } from '../types';
import { ruleMatchesContext } from './rule-evaluator';

export class Router {
  readonly rules: RoutingRule[];

  constructor(rules: RoutingRule[]) {
    this.rules = [...rules].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    );
  }

  decide(context: RoutingContext): RoutingDecision | null {
    if (context.providerOverride) {
      return {
        provider: context.providerOverride,
        reason: 'provider override',
      };
    }

    for (const rule of this.rules) {
      if (!ruleMatchesContext(rule, context)) {
        continue;
      }

      if (context.excludedProviders?.includes(rule.provider)) {
        continue;
      }

      return {
        provider: rule.provider,
        reason: rule.isDefault ? 'default rule' : 'matched rule',
        ruleId: rule.id,
      };
    }

    return null;
  }
}
