export type RoutingMatchValue = string | string[];

export interface RoutingMatch {
  currency?: RoutingMatchValue;
  country?: RoutingMatchValue;
  paymentMethod?: RoutingMatchValue;
  amountMin?: number;
  amountMax?: number;
  metadata?: Record<string, string>;
  default?: boolean;
}

export interface RoutingRule {
  match: RoutingMatch;
  provider: string;
  weight?: number;
}

export interface RoutingContext {
  currency?: string;
  country?: string;
  paymentMethod?: string;
  amount?: number;
  metadata?: Record<string, string>;
  providerOverride?: string;
  exclude?: string[];
}

export interface RoutingDecision {
  provider: string;
  reason: string;
  rule: RoutingRule;
}
