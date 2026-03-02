export type PaymentStatus =
  | 'completed'
  | 'pending'
  | 'requires_action'
  | 'declined'
  | 'failed'
  | 'cancelled'
  | 'authorized';

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

export interface AddressInput {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface CustomerInput {
  email?: string;
  name?: string;
  phone?: string;
  document?: string;
  address?: AddressInput;
}

export interface RoutingPreference {
  provider?: string;
  exclude?: string[];
}

export interface ChargeRequest {
  amount: number;
  currency: string;
  paymentMethod: PaymentMethodInput;
  customer?: CustomerInput;
  description?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  routing?: RoutingPreference;
}

export type AuthorizeRequest = ChargeRequest;

export interface CaptureRequest {
  transactionId: string;
  amount?: number;
  idempotencyKey?: string;
}

export interface RefundRequest {
  transactionId: string;
  amount?: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface VoidRequest {
  transactionId: string;
  idempotencyKey?: string;
}

export interface PaymentResult {
  id: string;
  status: PaymentStatus;
  provider: string;
  providerId: string;
  amount: number;
  currency: string;
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
  metadata: Record<string, string>;
  routing: {
    source: 'local' | 'platform';
    reason: string;
  };
  createdAt: string;
  providerMetadata: Record<string, unknown>;
}

export interface RefundResult {
  id: string;
  transactionId: string;
  status: 'completed' | 'pending' | 'failed';
  amount: number;
  currency: string;
  provider: string;
  providerId: string;
  reason?: string;
  createdAt: string;
}

export interface VoidResult {
  id: string;
  transactionId: string;
  status: 'completed' | 'failed';
  provider: string;
  createdAt: string;
}

export interface StatusChange {
  status: PaymentStatus;
  timestamp: string;
  reason?: string;
}

export interface TransactionStatus {
  id: string;
  status: PaymentStatus;
  provider: string;
  providerId: string;
  amount: number;
  currency: string;
  history: StatusChange[];
  updatedAt: string;
}

export interface PaymentMethodInfo {
  type: string;
  provider: string;
  name: string;
  currencies: string[];
  countries: string[];
  minAmount?: number;
  maxAmount?: number;
}
