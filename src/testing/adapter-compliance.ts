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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const PAYMENT_STATUSES = new Set([
  'completed',
  'pending',
  'requires_action',
  'declined',
  'failed',
  'cancelled',
  'authorized',
]);

const REFUND_STATUSES = new Set(['completed', 'pending', 'failed']);
const VOID_STATUSES = new Set(['completed', 'failed']);
const ROUTING_SOURCES = new Set(['local', 'platform']);

export class AdapterComplianceError extends Error {
  readonly operation: string;
  readonly field?: string;

  constructor(operation: string, message: string, field?: string) {
    super(`[${operation}] ${message}`);
    this.name = 'AdapterComplianceError';
    this.operation = operation;
    this.field = field;
  }
}

function assertCondition(
  condition: boolean,
  operation: string,
  message: string,
  field?: string,
): void {
  if (!condition) {
    throw new AdapterComplianceError(operation, message, field);
  }
}

function validateStringArray(
  operation: string,
  field: string,
  value: unknown,
): void {
  assertCondition(
    Array.isArray(value),
    operation,
    `${field} must be an array.`,
    field,
  );
  assertCondition(
    (value as unknown[]).every(isNonEmptyString),
    operation,
    `${field} must contain non-empty strings.`,
    field,
  );
}

export function validatePaymentResult(
  value: PaymentResult,
  operation: string,
  expectedProvider?: string,
): void {
  assertCondition(isRecord(value), operation, 'Result must be an object.');
  assertCondition(
    isNonEmptyString(value.id),
    operation,
    'id must be a non-empty string.',
    'id',
  );
  assertCondition(
    isNonEmptyString(value.provider),
    operation,
    'provider must be a non-empty string.',
    'provider',
  );
  if (expectedProvider) {
    assertCondition(
      value.provider === expectedProvider,
      operation,
      `provider must equal "${expectedProvider}".`,
      'provider',
    );
  }
  assertCondition(
    isNonEmptyString(value.providerId),
    operation,
    'providerId must be a non-empty string.',
    'providerId',
  );
  assertCondition(
    isNumber(value.amount),
    operation,
    'amount must be a number.',
    'amount',
  );
  assertCondition(
    isNonEmptyString(value.currency),
    operation,
    'currency must be a non-empty string.',
    'currency',
  );
  assertCondition(
    PAYMENT_STATUSES.has(value.status),
    operation,
    'status must be a canonical payment status.',
    'status',
  );
  assertCondition(
    isRecord(value.paymentMethod),
    operation,
    'paymentMethod must be an object.',
    'paymentMethod',
  );
  assertCondition(
    isNonEmptyString(value.paymentMethod.type),
    operation,
    'paymentMethod.type must be a non-empty string.',
    'paymentMethod.type',
  );
  assertCondition(
    isRecord(value.routing),
    operation,
    'routing must be an object.',
    'routing',
  );
  assertCondition(
    ROUTING_SOURCES.has(value.routing.source),
    operation,
    'routing.source must be "local" or "platform".',
    'routing.source',
  );
  assertCondition(
    isNonEmptyString(value.routing.reason),
    operation,
    'routing.reason must be a non-empty string.',
    'routing.reason',
  );
  assertCondition(
    isNonEmptyString(value.createdAt),
    operation,
    'createdAt must be a non-empty string.',
    'createdAt',
  );
  assertCondition(
    isRecord(value.metadata),
    operation,
    'metadata must be an object.',
    'metadata',
  );
  assertCondition(
    isRecord(value.providerMetadata),
    operation,
    'providerMetadata must be an object.',
    'providerMetadata',
  );
}

export function validateRefundResult(
  value: RefundResult,
  operation = 'refund',
  expectedProvider?: string,
): void {
  assertCondition(isRecord(value), operation, 'Result must be an object.');
  assertCondition(
    isNonEmptyString(value.id),
    operation,
    'id must be a non-empty string.',
    'id',
  );
  assertCondition(
    isNonEmptyString(value.transactionId),
    operation,
    'transactionId must be a non-empty string.',
    'transactionId',
  );
  assertCondition(
    REFUND_STATUSES.has(value.status),
    operation,
    'status must be "completed", "pending", or "failed".',
    'status',
  );
  assertCondition(
    isNumber(value.amount),
    operation,
    'amount must be a number.',
    'amount',
  );
  assertCondition(
    isNonEmptyString(value.currency),
    operation,
    'currency must be a non-empty string.',
    'currency',
  );
  assertCondition(
    isNonEmptyString(value.provider),
    operation,
    'provider must be a non-empty string.',
    'provider',
  );
  if (expectedProvider) {
    assertCondition(
      value.provider === expectedProvider,
      operation,
      `provider must equal "${expectedProvider}".`,
      'provider',
    );
  }
  assertCondition(
    isNonEmptyString(value.providerId),
    operation,
    'providerId must be a non-empty string.',
    'providerId',
  );
  assertCondition(
    isNonEmptyString(value.createdAt),
    operation,
    'createdAt must be a non-empty string.',
    'createdAt',
  );
}

export function validateVoidResult(
  value: VoidResult,
  operation = 'void',
  expectedProvider?: string,
): void {
  assertCondition(isRecord(value), operation, 'Result must be an object.');
  assertCondition(
    isNonEmptyString(value.id),
    operation,
    'id must be a non-empty string.',
    'id',
  );
  assertCondition(
    isNonEmptyString(value.transactionId),
    operation,
    'transactionId must be a non-empty string.',
    'transactionId',
  );
  assertCondition(
    VOID_STATUSES.has(value.status),
    operation,
    'status must be "completed" or "failed".',
    'status',
  );
  assertCondition(
    isNonEmptyString(value.provider),
    operation,
    'provider must be a non-empty string.',
    'provider',
  );
  if (expectedProvider) {
    assertCondition(
      value.provider === expectedProvider,
      operation,
      `provider must equal "${expectedProvider}".`,
      'provider',
    );
  }
  assertCondition(
    isNonEmptyString(value.createdAt),
    operation,
    'createdAt must be a non-empty string.',
    'createdAt',
  );
}

export function validateTransactionStatus(
  value: TransactionStatus,
  operation = 'getStatus',
  expectedProvider?: string,
): void {
  assertCondition(isRecord(value), operation, 'Result must be an object.');
  assertCondition(
    isNonEmptyString(value.id),
    operation,
    'id must be a non-empty string.',
    'id',
  );
  assertCondition(
    isNonEmptyString(value.provider),
    operation,
    'provider must be a non-empty string.',
    'provider',
  );
  if (expectedProvider) {
    assertCondition(
      value.provider === expectedProvider,
      operation,
      `provider must equal "${expectedProvider}".`,
      'provider',
    );
  }
  assertCondition(
    isNonEmptyString(value.providerId),
    operation,
    'providerId must be a non-empty string.',
    'providerId',
  );
  assertCondition(
    isNumber(value.amount),
    operation,
    'amount must be a number.',
    'amount',
  );
  assertCondition(
    isNonEmptyString(value.currency),
    operation,
    'currency must be a non-empty string.',
    'currency',
  );
  assertCondition(
    PAYMENT_STATUSES.has(value.status),
    operation,
    'status must be a canonical payment status.',
    'status',
  );
  assertCondition(
    Array.isArray(value.history),
    operation,
    'history must be an array.',
    'history',
  );
  for (const [index, item] of value.history.entries()) {
    const fieldPrefix = `history[${index}]`;
    assertCondition(
      isRecord(item),
      operation,
      `${fieldPrefix} must be an object.`,
      fieldPrefix,
    );
    assertCondition(
      PAYMENT_STATUSES.has(item.status),
      operation,
      `${fieldPrefix}.status must be a canonical payment status.`,
      `${fieldPrefix}.status`,
    );
    assertCondition(
      isNonEmptyString(item.timestamp),
      operation,
      `${fieldPrefix}.timestamp must be a non-empty string.`,
      `${fieldPrefix}.timestamp`,
    );
  }
  assertCondition(
    isNonEmptyString(value.updatedAt),
    operation,
    'updatedAt must be a non-empty string.',
    'updatedAt',
  );
}

export function validatePaymentMethods(
  methods: PaymentMethodInfo[],
  operation = 'listPaymentMethods',
  expectedProvider?: string,
): void {
  assertCondition(
    Array.isArray(methods),
    operation,
    'Result must be an array.',
    'paymentMethods',
  );
  for (const [index, method] of methods.entries()) {
    const fieldPrefix = `paymentMethods[${index}]`;
    assertCondition(
      isRecord(method),
      operation,
      `${fieldPrefix} must be an object.`,
      fieldPrefix,
    );
    assertCondition(
      isNonEmptyString(method.type),
      operation,
      `${fieldPrefix}.type must be a non-empty string.`,
      `${fieldPrefix}.type`,
    );
    assertCondition(
      isNonEmptyString(method.provider),
      operation,
      `${fieldPrefix}.provider must be a non-empty string.`,
      `${fieldPrefix}.provider`,
    );
    if (expectedProvider) {
      assertCondition(
        method.provider === expectedProvider,
        operation,
        `${fieldPrefix}.provider must equal "${expectedProvider}".`,
        `${fieldPrefix}.provider`,
      );
    }
    assertCondition(
      isNonEmptyString(method.name),
      operation,
      `${fieldPrefix}.name must be a non-empty string.`,
      `${fieldPrefix}.name`,
    );
    validateStringArray(
      operation,
      `${fieldPrefix}.currencies`,
      method.currencies,
    );
    validateStringArray(
      operation,
      `${fieldPrefix}.countries`,
      method.countries,
    );
    if (typeof method.minAmount !== 'undefined') {
      assertCondition(
        isNumber(method.minAmount),
        operation,
        `${fieldPrefix}.minAmount must be a number when provided.`,
        `${fieldPrefix}.minAmount`,
      );
    }
    if (typeof method.maxAmount !== 'undefined') {
      assertCondition(
        isNumber(method.maxAmount),
        operation,
        `${fieldPrefix}.maxAmount must be a number when provided.`,
        `${fieldPrefix}.maxAmount`,
      );
    }
  }
}

export function validateWebhookEvent(
  event: VaultEvent,
  operation = 'handleWebhook',
  expectedProvider?: string,
): void {
  assertCondition(isRecord(event), operation, 'Result must be an object.');
  assertCondition(
    isNonEmptyString(event.id),
    operation,
    'id must be a non-empty string.',
    'id',
  );
  assertCondition(
    isNonEmptyString(event.provider),
    operation,
    'provider must be a non-empty string.',
    'provider',
  );
  if (expectedProvider) {
    assertCondition(
      event.provider === expectedProvider,
      operation,
      `provider must equal "${expectedProvider}".`,
      'provider',
    );
  }
  assertCondition(
    isNonEmptyString(event.type),
    operation,
    'type must be a non-empty string.',
    'type',
  );
  assertCondition(
    isNonEmptyString(event.providerEventId),
    operation,
    'providerEventId must be a non-empty string.',
    'providerEventId',
  );
  assertCondition(
    isNonEmptyString(event.timestamp),
    operation,
    'timestamp must be a non-empty string.',
    'timestamp',
  );
}

export interface AdapterComplianceHarness {
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
  handleWebhook(
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<VaultEvent>;
}

export interface AdapterComplianceHarnessOptions {
  expectedProvider?: string;
}

export function createAdapterComplianceHarness(
  adapter: PaymentAdapter,
  options: AdapterComplianceHarnessOptions = {},
): AdapterComplianceHarness {
  const expectedProvider = options.expectedProvider ?? adapter.name;

  return {
    async charge(request) {
      const result = await adapter.charge(request);
      validatePaymentResult(result, 'charge', expectedProvider);
      return result;
    },
    async authorize(request) {
      const result = await adapter.authorize(request);
      validatePaymentResult(result, 'authorize', expectedProvider);
      return result;
    },
    async capture(request) {
      const result = await adapter.capture(request);
      validatePaymentResult(result, 'capture', expectedProvider);
      return result;
    },
    async refund(request) {
      const result = await adapter.refund(request);
      validateRefundResult(result, 'refund', expectedProvider);
      return result;
    },
    async void(request) {
      const result = await adapter.void(request);
      validateVoidResult(result, 'void', expectedProvider);
      return result;
    },
    async getStatus(transactionId) {
      const result = await adapter.getStatus(transactionId);
      validateTransactionStatus(result, 'getStatus', expectedProvider);
      return result;
    },
    async listPaymentMethods(country, currency) {
      const result = await adapter.listPaymentMethods(country, currency);
      validatePaymentMethods(result, 'listPaymentMethods', expectedProvider);
      return result;
    },
    async handleWebhook(payload, headers) {
      if (!adapter.handleWebhook) {
        throw new AdapterComplianceError(
          'handleWebhook',
          'Adapter does not implement handleWebhook.',
        );
      }

      const result = await adapter.handleWebhook(payload, headers);
      validateWebhookEvent(result, 'handleWebhook', expectedProvider);
      return result;
    },
  };
}
