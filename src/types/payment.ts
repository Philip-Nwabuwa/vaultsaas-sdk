/**
 * @description Normalized payment status across all providers.
 * Each adapter maps provider-specific statuses to one of these canonical values.
 */
export type PaymentStatus =
  | 'completed'
  | 'pending'
  | 'requires_action'
  | 'declined'
  | 'failed'
  | 'cancelled'
  | 'authorized';

/**
 * @description Payment method input discriminated by `type`. Supports card (token or raw),
 * bank transfer, wallet, PIX, and boleto payment methods.
 */
export type PaymentMethodInput =
  | { type: 'card'; token: string }
  | {
      type: 'card';
      number: string;
      expMonth: number;
      expYear: number;
      cvc: string;
    }
  | { type: 'bank_transfer'; bankCode: string; accountNumber: string }
  | { type: 'wallet'; walletType: string; token: string }
  | { type: 'pix' }
  | { type: 'boleto'; customerDocument: string };

/** @description Customer billing or shipping address. */
export interface AddressInput {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "US", "BR"). */
  country: string;
}

/** @description Customer details passed with a charge or authorize request. */
export interface CustomerInput {
  email?: string;
  name?: string;
  phone?: string;
  /** Tax ID or national document number (e.g. CPF in Brazil). */
  document?: string;
  address?: AddressInput;
}

/**
 * @description Per-request routing overrides. Force a specific provider or exclude
 * providers from selection.
 */
export interface RoutingPreference {
  /** Force routing to this provider, bypassing rules. */
  provider?: string;
  /** Provider names to exclude from routing consideration. */
  exclude?: string[];
}

/**
 * @description Request payload for a one-step charge (immediate capture).
 *
 * @example
 * ```ts
 * const request: ChargeRequest = {
 *   amount: 5000,
 *   currency: 'USD',
 *   paymentMethod: { type: 'card', token: 'tok_visa' },
 *   idempotencyKey: 'order-123',
 * };
 * ```
 */
export interface ChargeRequest {
  /** Amount in the smallest currency unit (e.g. cents for USD). */
  amount: number;
  /** ISO 4217 currency code (e.g. "USD", "BRL"). */
  currency: string;
  paymentMethod: PaymentMethodInput;
  customer?: CustomerInput;
  description?: string;
  /** Arbitrary key-value pairs forwarded to the provider. */
  metadata?: Record<string, string>;
  /** Prevents duplicate charges when retrying the same request. */
  idempotencyKey?: string;
  routing?: RoutingPreference;
}

/**
 * @description Request payload for a two-step authorization (hold funds without capture).
 * Identical shape to {@link ChargeRequest}; the client calls `authorize` instead of `charge`.
 */
export type AuthorizeRequest = ChargeRequest;

/**
 * @description Request payload to capture a previously authorized transaction.
 */
export interface CaptureRequest {
  /** The transaction ID returned from a prior `authorize` call. */
  transactionId: string;
  /** Partial capture amount. Omit to capture the full authorized amount. */
  amount?: number;
  idempotencyKey?: string;
}

/**
 * @description Request payload to refund a completed transaction (full or partial).
 */
export interface RefundRequest {
  /** The transaction ID of the original charge or capture. */
  transactionId: string;
  /** Partial refund amount. Omit to refund the full amount. */
  amount?: number;
  /** Human-readable reason forwarded to the provider. */
  reason?: string;
  idempotencyKey?: string;
}

/**
 * @description Request payload to void (cancel) an authorized transaction before capture.
 */
export interface VoidRequest {
  /** The transaction ID of the authorization to void. */
  transactionId: string;
  idempotencyKey?: string;
}

/**
 * @description Normalized result returned by `charge`, `authorize`, and `capture` operations.
 * Provider-specific data is available via `providerMetadata`.
 */
export interface PaymentResult {
  /** VaultSaaS-normalized transaction identifier. */
  id: string;
  status: PaymentStatus;
  /** Name of the provider that processed the transaction (e.g. "stripe"). */
  provider: string;
  /** Provider's own identifier for this transaction. */
  providerId: string;
  /** Amount in smallest currency unit. */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** Snapshot of the payment method used. */
  paymentMethod: {
    type: string;
    last4?: string;
    brand?: string;
    expiryMonth?: number;
    expiryYear?: number;
  };
  customer?: {
    id?: string;
    email?: string;
  };
  /** Merged metadata from the request and provider response. */
  metadata: Record<string, string>;
  /** How the provider was selected for this transaction. */
  routing: {
    source: 'local' | 'platform';
    reason: string;
  };
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Raw provider-specific fields not mapped to the normalized schema. */
  providerMetadata: Record<string, unknown>;
}

/** @description Normalized result returned by a `refund` operation. */
export interface RefundResult {
  /** Unique refund identifier. */
  id: string;
  /** The original transaction that was refunded. */
  transactionId: string;
  status: 'completed' | 'pending' | 'failed';
  /** Refunded amount in smallest currency unit. */
  amount: number;
  currency: string;
  provider: string;
  providerId: string;
  reason?: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** @description Normalized result returned by a `void` (cancellation) operation. */
export interface VoidResult {
  id: string;
  /** The original authorized transaction that was voided. */
  transactionId: string;
  status: 'completed' | 'failed';
  provider: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** @description A single entry in a transaction's status history timeline. */
export interface StatusChange {
  status: PaymentStatus;
  /** ISO 8601 timestamp when this status was recorded. */
  timestamp: string;
  reason?: string;
}

/** @description Full transaction status including status history, returned by `getStatus`. */
export interface TransactionStatus {
  id: string;
  status: PaymentStatus;
  provider: string;
  providerId: string;
  amount: number;
  currency: string;
  /** Chronological status changes for this transaction. */
  history: StatusChange[];
  /** ISO 8601 timestamp of the most recent status update. */
  updatedAt: string;
}

/**
 * @description Describes a payment method supported by a provider for a given
 * country/currency combination. Returned by `listPaymentMethods`.
 */
export interface PaymentMethodInfo {
  /** Payment method type identifier (e.g. "card", "pix", "bank_transfer"). */
  type: string;
  provider: string;
  /** Human-readable display name. */
  name: string;
  /** ISO 4217 currency codes this method supports. */
  currencies: string[];
  /** ISO 3166-1 alpha-2 country codes this method supports. */
  countries: string[];
  /** Minimum amount in smallest currency unit, if applicable. */
  minAmount?: number;
  /** Maximum amount in smallest currency unit, if applicable. */
  maxAmount?: number;
}
