export type VaultErrorCategory =
  | 'card_declined'
  | 'authentication_required'
  | 'invalid_request'
  | 'provider_error'
  | 'fraud_suspected'
  | 'rate_limited'
  | 'network_error'
  | 'configuration_error'
  | 'routing_error'
  | 'unknown';
