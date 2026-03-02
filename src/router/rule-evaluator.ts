import type { RoutingContext, RoutingRule } from '../types';

function matchesValue(ruleValue: string | string[], input?: string): boolean {
  if (input === undefined) {
    return false;
  }

  return Array.isArray(ruleValue)
    ? ruleValue.includes(input)
    : ruleValue === input;
}

export function ruleMatchesContext(
  rule: RoutingRule,
  context: RoutingContext,
): boolean {
  const { match } = rule;

  if (match.default) {
    return true;
  }

  if (match.country && !matchesValue(match.country, context.country)) {
    return false;
  }

  if (match.currency && !matchesValue(match.currency, context.currency)) {
    return false;
  }

  if (
    match.paymentMethod &&
    !matchesValue(match.paymentMethod, context.paymentMethod)
  ) {
    return false;
  }

  if (
    match.amountMin !== undefined &&
    (context.amount ?? Number.NEGATIVE_INFINITY) < match.amountMin
  ) {
    return false;
  }

  if (
    match.amountMax !== undefined &&
    (context.amount ?? Number.POSITIVE_INFINITY) > match.amountMax
  ) {
    return false;
  }

  if (match.metadata) {
    for (const [key, expected] of Object.entries(match.metadata)) {
      if (context.metadata?.[key] !== expected) {
        return false;
      }
    }
  }

  return true;
}
