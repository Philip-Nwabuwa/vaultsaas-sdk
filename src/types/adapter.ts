import type { VaultEvent } from './events';
import type {
  AuthorizeRequest,
  CaptureRequest,
  ChargeRequest,
  PaymentMethodInfo,
  PaymentResult,
  RefundRequest,
  RefundResult,
  TransactionStatus,
  VoidRequest,
  VoidResult,
} from './payment';

/** Static provider capability declaration used by routing validation. */
export interface AdapterMetadata {
  readonly supportedMethods: readonly string[];
  readonly supportedCurrencies: readonly string[];
  readonly supportedCountries: readonly string[];
}

/** Runtime adapter contract used by `VaultClient`. */
export interface PaymentAdapter {
  readonly name: string;
  readonly metadata: AdapterMetadata;
  charge(request: ChargeRequest): Promise<PaymentResult>;
  authorize(request: AuthorizeRequest): Promise<PaymentResult>;
  capture(request: CaptureRequest): Promise<PaymentResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  void(request: VoidRequest): Promise<VoidResult>;
  getStatus(transactionId: string): Promise<TransactionStatus>;
  listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodInfo[]>;
  handleWebhook?(
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<VaultEvent> | VaultEvent;
}

/** Adapter class contract used in provider configuration. */
export interface PaymentAdapterConstructor {
  new (config: Record<string, unknown>): PaymentAdapter;
  readonly supportedMethods: readonly string[];
  readonly supportedCurrencies: readonly string[];
  readonly supportedCountries: readonly string[];
}
