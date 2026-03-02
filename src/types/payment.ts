export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'voided';

export interface ChargeRequest {
  amount: number;
  currency: string;
  paymentMethod: string;
  country?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface AuthorizeRequest extends ChargeRequest {}

export interface CaptureRequest {
  transactionId: string;
  amount?: number;
  currency?: string;
  metadata?: Record<string, string>;
}

export interface RefundRequest {
  transactionId: string;
  amount?: number;
  currency?: string;
  reason?: string;
  metadata?: Record<string, string>;
}

export interface VoidRequest {
  transactionId: string;
  reason?: string;
}

export interface PaymentResult {
  transactionId: string;
  status: PaymentStatus;
  provider: string;
  amount: number;
  currency: string;
  raw?: unknown;
}

export interface RefundResult {
  refundId: string;
  transactionId: string;
  status: Extract<
    PaymentStatus,
    'pending' | 'succeeded' | 'failed' | 'refunded'
  >;
  provider: string;
  amount?: number;
  currency?: string;
  raw?: unknown;
}

export interface VoidResult {
  transactionId: string;
  status: Extract<PaymentStatus, 'voided' | 'failed'>;
  provider: string;
  raw?: unknown;
}

export interface TransactionStatus {
  transactionId: string;
  status: PaymentStatus;
  provider: string;
  updatedAt: string;
  reason?: string;
  raw?: unknown;
}

export interface PaymentMethodDescriptor {
  id: string;
  type: string;
  displayName?: string;
  countries?: string[];
  currencies?: string[];
}
