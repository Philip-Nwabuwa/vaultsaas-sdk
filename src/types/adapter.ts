import type {
  AuthorizeRequest,
  CaptureRequest,
  ChargeRequest,
  PaymentMethodDescriptor,
  PaymentResult,
  RefundRequest,
  RefundResult,
  TransactionStatus,
  VoidRequest,
  VoidResult,
} from './payment';

export interface PaymentAdapter {
  readonly name: string;
  charge(request: ChargeRequest): Promise<PaymentResult>;
  authorize(request: AuthorizeRequest): Promise<PaymentResult>;
  capture(request: CaptureRequest): Promise<PaymentResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
  void(request: VoidRequest): Promise<VoidResult>;
  getStatus(transactionId: string): Promise<TransactionStatus>;
  listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodDescriptor[]>;
}
