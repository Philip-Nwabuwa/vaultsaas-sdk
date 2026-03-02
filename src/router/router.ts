import { VaultRoutingError } from '../errors';
import type { RoutingContext, RoutingDecision, RoutingRule } from '../types';
import { ruleMatchesContext } from './rule-evaluator';

interface WeightedCandidate {
  index: number;
  rule: RoutingRule;
}

export interface RouterOptions {
  random?: () => number;
}

export class Router {
  readonly rules: RoutingRule[];
  private readonly random: () => number;

  constructor(rules: RoutingRule[], options: RouterOptions = {}) {
    this.rules = [...rules];
    this.random = options.random ?? Math.random;

    if (!this.rules.some((rule) => rule.match.default)) {
      throw new VaultRoutingError(
        'Routing rules must include a default fallback rule.',
      );
    }
  }

  decide(context: RoutingContext): RoutingDecision | null {
    if (context.providerOverride) {
      if (context.exclude?.includes(context.providerOverride)) {
        return null;
      }

      return {
        provider: context.providerOverride,
        reason: `provider override selected ${context.providerOverride}`,
        rule: {
          provider: context.providerOverride,
          match: {
            default: true,
          },
        },
      };
    }

    for (let index = 0; index < this.rules.length; index += 1) {
      const rule = this.rules[index];
      if (!rule) {
        continue;
      }

      if (context.exclude?.includes(rule.provider)) {
        continue;
      }

      if (!ruleMatchesContext(rule, context)) {
        continue;
      }

      if (rule.weight !== undefined) {
        const weightedCandidates = this.getWeightedCandidates(index, context);
        if (weightedCandidates.length > 0) {
          const selected = this.selectWeightedRule(weightedCandidates);
          return {
            provider: selected.rule.provider,
            reason: this.buildWeightedReason(
              selected,
              weightedCandidates.length,
            ),
            rule: selected.rule,
          };
        }
      }

      return {
        provider: rule.provider,
        reason: this.buildRuleReason(rule, index),
        rule,
      };
    }

    return null;
  }

  private getWeightedCandidates(
    startIndex: number,
    context: RoutingContext,
  ): WeightedCandidate[] {
    const candidates: WeightedCandidate[] = [];

    for (let index = startIndex; index < this.rules.length; index += 1) {
      const rule = this.rules[index];
      if (!rule) {
        continue;
      }

      if (!ruleMatchesContext(rule, context)) {
        break;
      }

      if (rule.weight === undefined) {
        break;
      }

      if (context.exclude?.includes(rule.provider)) {
        continue;
      }

      if (rule.weight > 0) {
        candidates.push({
          index,
          rule,
        });
      }
    }

    return candidates;
  }

  private selectWeightedRule(
    candidates: WeightedCandidate[],
  ): WeightedCandidate {
    const totalWeight = candidates.reduce(
      (acc, candidate) => acc + (candidate.rule.weight ?? 0),
      0,
    );

    const randomValue = this.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const candidate of candidates) {
      cumulativeWeight += candidate.rule.weight ?? 0;
      if (randomValue < cumulativeWeight) {
        return candidate;
      }
    }

    const fallback = candidates[candidates.length - 1];
    if (!fallback) {
      throw new VaultRoutingError(
        'No weighted routing candidates were available.',
      );
    }

    return fallback;
  }

  private buildRuleReason(rule: RoutingRule, index: number): string {
    if (rule.match.default) {
      return `default fallback rule matched at index ${index}`;
    }

    const criteria = this.getMatchCriteria(rule);
    if (criteria.length > 0) {
      return `rule matched at index ${index} using ${criteria.join(', ')}`;
    }

    return `rule matched at index ${index}`;
  }

  private buildWeightedReason(
    selected: WeightedCandidate,
    candidateCount: number,
  ): string {
    return `weighted selection chose provider ${selected.rule.provider} from ${candidateCount} candidates starting at index ${selected.index}`;
  }

  private getMatchCriteria(rule: RoutingRule): string[] {
    const criteria: string[] = [];

    if (rule.match.currency !== undefined) {
      criteria.push('currency');
    }

    if (rule.match.country !== undefined) {
      criteria.push('country');
    }

    if (rule.match.paymentMethod !== undefined) {
      criteria.push('paymentMethod');
    }

    if (
      rule.match.amountMin !== undefined ||
      rule.match.amountMax !== undefined
    ) {
      criteria.push('amount');
    }

    if (rule.match.metadata !== undefined) {
      criteria.push('metadata');
    }

    return criteria;
  }
}
