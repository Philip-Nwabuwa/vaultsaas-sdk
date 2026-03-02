import type {
  AuthorizeRequest,
  CaptureRequest,
  ChargeRequest,
  PaymentAdapter,
  PaymentMethodInfo,
  PaymentResult,
  RefundRequest,
  RefundResult,
  TransactionStatus,
  VaultEvent,
  VoidRequest,
  VoidResult,
} from '../types';

type SyncOrAsync<T> = T | Promise<T>;

type ListPaymentMethodsInput = {
  country: string;
  currency: string;
};

type HandleWebhookInput = {
  payload: Buffer | string;
  headers: Record<string, string>;
};

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
  ) => Promise<PaymentMethodInfo[]>;
  handleWebhook: (
    payload: Buffer | string,
    headers: Record<string, string>,
  ) => SyncOrAsync<VaultEvent>;
};

export type MockAdapterHandlers = Partial<HandlerMap>;

export type MockAdapterScenario<Input, Output> =
  | Output
  | Error
  | ((input: Input) => SyncOrAsync<Output>);

export interface MockAdapterScenarios {
  charge: MockAdapterScenario<ChargeRequest, PaymentResult>[];
  authorize: MockAdapterScenario<AuthorizeRequest, PaymentResult>[];
  capture: MockAdapterScenario<CaptureRequest, PaymentResult>[];
  refund: MockAdapterScenario<RefundRequest, RefundResult>[];
  void: MockAdapterScenario<VoidRequest, VoidResult>[];
  getStatus: MockAdapterScenario<string, TransactionStatus>[];
  listPaymentMethods: MockAdapterScenario<
    ListPaymentMethodsInput,
    PaymentMethodInfo[]
  >[];
  handleWebhook: MockAdapterScenario<HandleWebhookInput, VaultEvent>[];
}

export interface MockAdapterOptions {
  name?: string;
  handlers?: MockAdapterHandlers;
  scenarios?: Partial<MockAdapterScenarios>;
}

type ScenarioQueue<Input, Output> = Array<(input: Input) => Promise<Output>>;

function unsupported(method: string): never {
  throw new Error(`MockAdapter handler not configured: ${method}`);
}

function hasMockAdapterOptions(
  value: MockAdapterOptions | MockAdapterHandlers,
): value is MockAdapterOptions {
  return 'handlers' in value || 'scenarios' in value || 'name' in value;
}

function toScenarioQueue<Input, Output>(
  scenarios?: MockAdapterScenario<Input, Output>[],
): ScenarioQueue<Input, Output> {
  if (!scenarios || scenarios.length === 0) {
    return [];
  }

  return scenarios.map((scenario) => {
    if (scenario instanceof Error) {
      return async () => Promise.reject(scenario);
    }

    if (typeof scenario === 'function') {
      return async (input) =>
        (scenario as (value: Input) => SyncOrAsync<Output>)(input);
    }

    return async () => scenario;
  });
}

export class MockAdapter implements PaymentAdapter {
  readonly name: string;
  private readonly handlers: MockAdapterHandlers;
  private readonly chargeScenarios: ScenarioQueue<ChargeRequest, PaymentResult>;
  private readonly authorizeScenarios: ScenarioQueue<
    AuthorizeRequest,
    PaymentResult
  >;
  private readonly captureScenarios: ScenarioQueue<
    CaptureRequest,
    PaymentResult
  >;
  private readonly refundScenarios: ScenarioQueue<RefundRequest, RefundResult>;
  private readonly voidScenarios: ScenarioQueue<VoidRequest, VoidResult>;
  private readonly statusScenarios: ScenarioQueue<string, TransactionStatus>;
  private readonly paymentMethodsScenarios: ScenarioQueue<
    ListPaymentMethodsInput,
    PaymentMethodInfo[]
  >;
  private readonly webhookScenarios: ScenarioQueue<
    HandleWebhookInput,
    VaultEvent
  >;

  constructor(options: MockAdapterOptions | MockAdapterHandlers = {}) {
    const normalized = hasMockAdapterOptions(options)
      ? options
      : { handlers: options };

    this.name = normalized.name ?? 'mock';
    this.handlers = normalized.handlers ?? {};
    this.chargeScenarios = toScenarioQueue(normalized.scenarios?.charge);
    this.authorizeScenarios = toScenarioQueue(normalized.scenarios?.authorize);
    this.captureScenarios = toScenarioQueue(normalized.scenarios?.capture);
    this.refundScenarios = toScenarioQueue(normalized.scenarios?.refund);
    this.voidScenarios = toScenarioQueue(normalized.scenarios?.void);
    this.statusScenarios = toScenarioQueue(normalized.scenarios?.getStatus);
    this.paymentMethodsScenarios = toScenarioQueue(
      normalized.scenarios?.listPaymentMethods,
    );
    this.webhookScenarios = toScenarioQueue(
      normalized.scenarios?.handleWebhook,
    );
  }

  enqueue(
    method: 'charge',
    scenario: MockAdapterScenario<ChargeRequest, PaymentResult>,
  ): this;
  enqueue(
    method: 'authorize',
    scenario: MockAdapterScenario<AuthorizeRequest, PaymentResult>,
  ): this;
  enqueue(
    method: 'capture',
    scenario: MockAdapterScenario<CaptureRequest, PaymentResult>,
  ): this;
  enqueue(
    method: 'refund',
    scenario: MockAdapterScenario<RefundRequest, RefundResult>,
  ): this;
  enqueue(
    method: 'void',
    scenario: MockAdapterScenario<VoidRequest, VoidResult>,
  ): this;
  enqueue(
    method: 'getStatus',
    scenario: MockAdapterScenario<string, TransactionStatus>,
  ): this;
  enqueue(
    method: 'listPaymentMethods',
    scenario: MockAdapterScenario<ListPaymentMethodsInput, PaymentMethodInfo[]>,
  ): this;
  enqueue(
    method: 'handleWebhook',
    scenario: MockAdapterScenario<HandleWebhookInput, VaultEvent>,
  ): this;
  enqueue(method: keyof MockAdapterScenarios, scenario: unknown): this {
    switch (method) {
      case 'charge':
        this.chargeScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<ChargeRequest, PaymentResult>,
          ]),
        );
        break;
      case 'authorize':
        this.authorizeScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<AuthorizeRequest, PaymentResult>,
          ]),
        );
        break;
      case 'capture':
        this.captureScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<CaptureRequest, PaymentResult>,
          ]),
        );
        break;
      case 'refund':
        this.refundScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<RefundRequest, RefundResult>,
          ]),
        );
        break;
      case 'void':
        this.voidScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<VoidRequest, VoidResult>,
          ]),
        );
        break;
      case 'getStatus':
        this.statusScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<string, TransactionStatus>,
          ]),
        );
        break;
      case 'listPaymentMethods':
        this.paymentMethodsScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<
              ListPaymentMethodsInput,
              PaymentMethodInfo[]
            >,
          ]),
        );
        break;
      case 'handleWebhook':
        this.webhookScenarios.push(
          ...toScenarioQueue([
            scenario as MockAdapterScenario<HandleWebhookInput, VaultEvent>,
          ]),
        );
        break;
      default:
        unsupported(method);
    }

    return this;
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    const scenario = this.chargeScenarios.shift();
    if (scenario) {
      return scenario(request);
    }

    const handler = this.handlers.charge;
    if (!handler) {
      unsupported('charge');
    }

    return handler(request);
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    const scenario = this.authorizeScenarios.shift();
    if (scenario) {
      return scenario(request);
    }

    const handler = this.handlers.authorize;
    if (!handler) {
      unsupported('authorize');
    }

    return handler(request);
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    const scenario = this.captureScenarios.shift();
    if (scenario) {
      return scenario(request);
    }

    const handler = this.handlers.capture;
    if (!handler) {
      unsupported('capture');
    }

    return handler(request);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const scenario = this.refundScenarios.shift();
    if (scenario) {
      return scenario(request);
    }

    const handler = this.handlers.refund;
    if (!handler) {
      unsupported('refund');
    }

    return handler(request);
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    const scenario = this.voidScenarios.shift();
    if (scenario) {
      return scenario(request);
    }

    const handler = this.handlers.void;
    if (!handler) {
      unsupported('void');
    }

    return handler(request);
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    const scenario = this.statusScenarios.shift();
    if (scenario) {
      return scenario(transactionId);
    }

    const handler = this.handlers.getStatus;
    if (!handler) {
      unsupported('getStatus');
    }

    return handler(transactionId);
  }

  async listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodInfo[]> {
    const scenario = this.paymentMethodsScenarios.shift();
    if (scenario) {
      return scenario({ country, currency });
    }

    const handler = this.handlers.listPaymentMethods;
    if (!handler) {
      unsupported('listPaymentMethods');
    }

    return handler(country, currency);
  }

  async handleWebhook(
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<VaultEvent> {
    const scenario = this.webhookScenarios.shift();
    if (scenario) {
      return scenario({ payload, headers });
    }

    const handler = this.handlers.handleWebhook;
    if (!handler) {
      unsupported('handleWebhook');
    }

    return handler(payload, headers);
  }
}
