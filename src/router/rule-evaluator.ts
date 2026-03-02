import type { RoutingContext, RoutingRule } from '../types';

export function ruleMatchesContext(
  rule: RoutingRule,
  context: RoutingContext,
): boolean {
  const conditions = rule.conditions;
  if (!conditions) {
    return true;
  }

  if (conditions.country && context.country !== conditions.country) {
    return false;
  }

  if (conditions.currency && context.currency !== conditions.currency) {
    return false;
  }

  if (
    conditions.paymentMethod &&
    context.paymentMethod !== conditions.paymentMethod
  ) {
    return false;
  }

  if (conditions.amount && context.amount !== undefined) {
    const { min, max } = conditions.amount;
    if (min !== undefined && context.amount < min) {
      return false;
    }

    if (max !== undefined && context.amount > max) {
      return false;
    }
  }

  if (conditions.metadata && context.metadata) {
    for (const [key, expected] of Object.entries(conditions.metadata)) {
      if (context.metadata[key] !== expected) {
        return false;
      }
    }
  }

  return true;
}
