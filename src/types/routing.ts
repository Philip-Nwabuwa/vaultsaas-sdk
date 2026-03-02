export interface AmountRange {
  min?: number;
  max?: number;
}

export interface RoutingConditions {
  country?: string;
  currency?: string;
  paymentMethod?: string;
  amount?: AmountRange;
  metadata?: Record<string, string>;
}

export interface RoutingRule {
  id: string;
  provider: string;
  priority?: number;
  weight?: number;
  isDefault?: boolean;
  conditions?: RoutingConditions;
}

export interface RoutingContext {
  country?: string;
  currency?: string;
  paymentMethod?: string;
  amount?: number;
  metadata?: Record<string, string>;
  providerOverride?: string;
  excludedProviders?: string[];
}

export interface RoutingDecision {
  provider: string;
  reason: string;
  ruleId?: string;
}
