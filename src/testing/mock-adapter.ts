import type {
  AuthorizeRequest,
  CaptureRequest,
  ChargeRequest,
  PaymentAdapter,
  PaymentMethodDescriptor,
  PaymentResult,
  RefundRequest,
  RefundResult,
  TransactionStatus,
  VoidRequest,
  VoidResult,
} from '../types';

type HandlerMap = {
  charge: (request: ChargeRequest) => Promise<PaymentResult>;
  authorize: (request: AuthorizeRequest) => Promise<PaymentResult>;
  capture: (request: CaptureRequest) => Promise<PaymentResult>;
  refund: (request: RefundRequest) => Promise<RefundResult>;
  void: (request: VoidRequest) => Promise<VoidResult>;
  getStatus: (transactionId: string) => Promise<TransactionStatus>;
  listPaymentMethods: (
    country: string,
    currency: string,
  ) => Promise<PaymentMethodDescriptor[]>;
};

function unsupported(method: string): never {
  throw new Error(`MockAdapter handler not configured: ${method}`);
}

export class MockAdapter implements PaymentAdapter {
  readonly name = 'mock';
  private readonly handlers: Partial<HandlerMap>;

  constructor(handlers: Partial<HandlerMap> = {}) {
    this.handlers = handlers;
  }

  charge(request: ChargeRequest): Promise<PaymentResult> {
    const handler = this.handlers.charge;
    return handler ? handler(request) : Promise.resolve(unsupported('charge'));
  }

  authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    const handler = this.handlers.authorize;
    return handler
      ? handler(request)
      : Promise.resolve(unsupported('authorize'));
  }

  capture(request: CaptureRequest): Promise<PaymentResult> {
    const handler = this.handlers.capture;
    return handler ? handler(request) : Promise.resolve(unsupported('capture'));
  }

  refund(request: RefundRequest): Promise<RefundResult> {
    const handler = this.handlers.refund;
    return handler ? handler(request) : Promise.resolve(unsupported('refund'));
  }

  void(request: VoidRequest): Promise<VoidResult> {
    const handler = this.handlers.void;
    return handler ? handler(request) : Promise.resolve(unsupported('void'));
  }

  getStatus(transactionId: string): Promise<TransactionStatus> {
    const handler = this.handlers.getStatus;
    return handler
      ? handler(transactionId)
      : Promise.resolve(unsupported('getStatus'));
  }

  listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodDescriptor[]> {
    const handler = this.handlers.listPaymentMethods;
    return handler
      ? handler(country, currency)
      : Promise.resolve(unsupported('listPaymentMethods'));
  }
}
