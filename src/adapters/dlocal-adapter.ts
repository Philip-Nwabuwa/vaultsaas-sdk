import { VaultConfigError, WebhookVerificationError } from '../errors';
import type {
  AuthorizeRequest,
  CaptureRequest,
  ChargeRequest,
  PaymentAdapter,
  PaymentMethodInfo,
  PaymentMethodInput,
  PaymentResult,
  RefundRequest,
  RefundResult,
  TransactionStatus,
  VaultEvent,
  VoidRequest,
  VoidResult,
} from '../types';
import { normalizeWebhookEvent } from '../webhooks';
import { readHeader, requestJson } from './shared/http';
import {
  createHmacDigest,
  secureCompareHex,
  toRawString,
} from './shared/signature';

const DEFAULT_DLOCAL_BASE_URL = 'https://api.dlocal.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DLOCAL_API_VERSION = '2.1';

interface DLocalAdapterConfig {
  xLogin: string;
  xTransKey: string;
  secretKey: string;
  webhookSecret?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface DLocalPayment {
  id?: string;
  payment_id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  order_id?: string;
  created_date?: string;
  payment_method_id?: string;
  card?: {
    last4?: string;
    holder_name?: string;
  };
  [key: string]: unknown;
}

interface DLocalRefund {
  id?: string;
  refund_id?: string;
  payment_id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  created_date?: string;
  [key: string]: unknown;
}

interface DLocalWebhookPayload {
  id?: string;
  type?: string;
  event?: string;
  payment_id?: string;
  transaction_id?: string;
  data?: Record<string, unknown>;
  created_date?: string;
  timestamp?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(
  source: Record<string, unknown> | null,
  key: string,
): string | undefined {
  if (!source) {
    return undefined;
  }

  const value = source[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(
  source: Record<string, unknown> | null,
  key: string,
): number | undefined {
  if (!source) {
    return undefined;
  }

  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function mapDLocalStatus(status: string | undefined): PaymentResult['status'] {
  switch (status?.toUpperCase()) {
    case 'AUTHORIZED':
      return 'authorized';
    case 'PAID':
    case 'APPROVED':
    case 'CAPTURED':
      return 'completed';
    case 'PENDING':
    case 'IN_PROCESS':
      return 'pending';
    case 'REJECTED':
    case 'DECLINED':
      return 'declined';
    case 'CANCELED':
    case 'CANCELLED':
      return 'cancelled';
    case 'REQUIRES_ACTION':
      return 'requires_action';
    default:
      return 'failed';
  }
}

function mapRefundStatus(status: string | undefined): RefundResult['status'] {
  switch (status?.toUpperCase()) {
    case 'COMPLETED':
    case 'APPROVED':
      return 'completed';
    case 'PENDING':
      return 'pending';
    default:
      return 'failed';
  }
}

function mapDLocalEventType(type?: string): VaultEvent['type'] {
  switch (type?.toLowerCase()) {
    case 'payment.approved':
    case 'payment.captured':
      return 'payment.completed';
    case 'payment.pending':
      return 'payment.pending';
    case 'payment.failed':
    case 'payment.rejected':
      return 'payment.failed';
    case 'payment.refunded':
      return 'payment.refunded';
    case 'payment.partially_refunded':
      return 'payment.partially_refunded';
    case 'chargeback.created':
      return 'payment.disputed';
    case 'chargeback.closed':
      return 'payment.dispute_resolved';
    default:
      return 'payment.failed';
  }
}

function mapPaymentMethod(
  paymentMethod: PaymentMethodInput,
): Record<string, unknown> {
  if (paymentMethod.type === 'card' && 'token' in paymentMethod) {
    return {
      payment_method_id: 'CARD',
      card: {
        token: paymentMethod.token,
      },
    };
  }

  if (paymentMethod.type === 'card') {
    return {
      payment_method_id: 'CARD',
      card: {
        number: paymentMethod.number,
        expiration_month: paymentMethod.expMonth,
        expiration_year: paymentMethod.expYear,
        cvv: paymentMethod.cvc,
      },
    };
  }

  if (paymentMethod.type === 'pix') {
    return {
      payment_method_id: 'PIX',
    };
  }

  if (paymentMethod.type === 'boleto') {
    return {
      payment_method_id: 'BOLETO',
      payer: {
        document: paymentMethod.customerDocument,
      },
    };
  }

  if (paymentMethod.type === 'bank_transfer') {
    return {
      payment_method_id: 'BANK_TRANSFER',
      bank_transfer: {
        bank_code: paymentMethod.bankCode,
        account_number: paymentMethod.accountNumber,
      },
    };
  }

  return {
    payment_method_id: paymentMethod.type.toUpperCase(),
  };
}

function timestampOrNow(input?: string): string {
  if (!input) {
    return new Date().toISOString();
  }

  const date = new Date(input);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

export class DLocalAdapter implements PaymentAdapter {
  readonly name = 'dlocal';
  static readonly supportedMethods = [
    'card',
    'pix',
    'boleto',
    'bank_transfer',
  ] as const;
  static readonly supportedCurrencies = [
    'BRL',
    'MXN',
    'ARS',
    'CLP',
    'COP',
    'PEN',
    'UYU',
    'BOB',
    'PYG',
    'CRC',
    'GTQ',
    'PAB',
    'DOP',
    'USD',
  ] as const;
  static readonly supportedCountries = [
    'BR',
    'MX',
    'AR',
    'CL',
    'CO',
    'PE',
    'UY',
    'BO',
    'PY',
    'CR',
    'GT',
    'PA',
    'DO',
    'EC',
    'SV',
    'NI',
    'HN',
  ] as const;
  readonly metadata = {
    supportedMethods: DLocalAdapter.supportedMethods,
    supportedCurrencies: DLocalAdapter.supportedCurrencies,
    supportedCountries: DLocalAdapter.supportedCountries,
  };
  private readonly config: Required<
    Pick<
      DLocalAdapterConfig,
      'xLogin' | 'xTransKey' | 'secretKey' | 'baseUrl' | 'timeoutMs' | 'fetchFn'
    >
  > &
    Pick<DLocalAdapterConfig, 'webhookSecret'>;

  constructor(rawConfig: Record<string, unknown>) {
    const xLogin =
      typeof rawConfig.xLogin === 'string' ? rawConfig.xLogin.trim() : '';
    const xTransKey =
      typeof rawConfig.xTransKey === 'string' ? rawConfig.xTransKey.trim() : '';
    const secretKey =
      typeof rawConfig.secretKey === 'string' ? rawConfig.secretKey.trim() : '';

    if (!xLogin || !xTransKey || !secretKey) {
      throw new VaultConfigError(
        'dLocal adapter requires config.xLogin, config.xTransKey, and config.secretKey.',
        {
          code: 'INVALID_CONFIGURATION',
          context: {
            provider: 'dlocal',
          },
        },
      );
    }

    const baseUrl =
      typeof rawConfig.baseUrl === 'string' && rawConfig.baseUrl.trim()
        ? rawConfig.baseUrl.trim()
        : DEFAULT_DLOCAL_BASE_URL;
    const timeoutMs =
      typeof rawConfig.timeoutMs === 'number' &&
      Number.isFinite(rawConfig.timeoutMs) &&
      rawConfig.timeoutMs > 0
        ? Math.floor(rawConfig.timeoutMs)
        : DEFAULT_TIMEOUT_MS;

    const customFetch = rawConfig.fetchFn;
    const fetchFn: typeof fetch =
      typeof customFetch === 'function' ? (customFetch as typeof fetch) : fetch;

    this.config = {
      xLogin,
      xTransKey,
      secretKey,
      baseUrl,
      timeoutMs,
      fetchFn,
      webhookSecret:
        typeof rawConfig.webhookSecret === 'string'
          ? rawConfig.webhookSecret
          : undefined,
    };
  }

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    return this.createPayment(request, false);
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    return this.createPayment(request, true);
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    const payment = await this.request<DLocalPayment>({
      operation: 'capture',
      path: `/v1/payments/${request.transactionId}/capture`,
      method: 'POST',
      body:
        request.amount !== undefined
          ? {
              amount: request.amount,
            }
          : undefined,
    });

    return this.normalizePaymentResult(
      payment,
      undefined,
      request.transactionId,
    );
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const refund = await this.request<DLocalRefund>({
      operation: 'refund',
      path: `/v1/payments/${request.transactionId}/refund`,
      method: 'POST',
      body: {
        amount: request.amount,
        reason: request.reason,
      },
    });

    return {
      id: refund.refund_id ?? refund.id ?? `refund_${Date.now()}`,
      transactionId: refund.payment_id ?? request.transactionId,
      status: mapRefundStatus(refund.status),
      amount: refund.amount ?? request.amount ?? 0,
      currency: (refund.currency ?? 'USD').toUpperCase(),
      provider: this.name,
      providerId: refund.id ?? refund.refund_id ?? request.transactionId,
      reason: refund.reason ?? request.reason,
      createdAt: timestampOrNow(refund.created_date),
    };
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    const payment = await this.request<DLocalPayment>({
      operation: 'void',
      path: `/v1/payments/${request.transactionId}/cancel`,
      method: 'POST',
      body: {},
    });

    return {
      id: `void_${payment.payment_id ?? payment.id ?? request.transactionId}`,
      transactionId: request.transactionId,
      status:
        mapDLocalStatus(payment.status) === 'cancelled'
          ? 'completed'
          : 'failed',
      provider: this.name,
      createdAt: timestampOrNow(payment.created_date),
    };
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    const payment = await this.request<DLocalPayment>({
      operation: 'getStatus',
      path: `/v1/payments/${transactionId}`,
      method: 'GET',
    });

    const status = mapDLocalStatus(payment.status);
    const timestamp = timestampOrNow(payment.created_date);
    return {
      id: payment.payment_id ?? payment.id ?? transactionId,
      status,
      provider: this.name,
      providerId: payment.id ?? payment.payment_id ?? transactionId,
      amount: payment.amount ?? 0,
      currency: (payment.currency ?? 'USD').toUpperCase(),
      history: [
        {
          status,
          timestamp,
          reason: `dlocal status: ${payment.status ?? 'unknown'}`,
        },
      ],
      updatedAt: timestamp,
    };
  }

  async listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodInfo[]> {
    const normalizedCurrency = currency.toUpperCase();
    return [
      {
        type: 'card',
        provider: this.name,
        name: 'dLocal Card',
        countries: [country],
        currencies: [normalizedCurrency],
      },
      {
        type: 'pix',
        provider: this.name,
        name: 'dLocal PIX',
        countries: ['BR'],
        currencies: ['BRL'],
      },
      {
        type: 'boleto',
        provider: this.name,
        name: 'dLocal Boleto',
        countries: ['BR'],
        currencies: ['BRL'],
      },
    ];
  }

  async handleWebhook(
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<VaultEvent> {
    const rawPayload = toRawString(payload);
    this.verifyWebhook(rawPayload, headers);

    let parsed: DLocalWebhookPayload;
    try {
      parsed = JSON.parse(rawPayload) as DLocalWebhookPayload;
    } catch {
      throw new WebhookVerificationError(
        'dLocal webhook payload is not valid JSON.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }

    const providerEventId = parsed.id ?? `evt_${Date.now()}`;
    return normalizeWebhookEvent(
      this.name,
      {
        id: providerEventId,
        providerEventId,
        type: mapDLocalEventType(parsed.type ?? parsed.event),
        transactionId:
          parsed.payment_id ??
          parsed.transaction_id ??
          readString(asRecord(parsed.data), 'payment_id'),
        data: parsed.data ?? {},
        timestamp: timestampOrNow(parsed.timestamp ?? parsed.created_date),
      },
      parsed,
    );
  }

  private verifyWebhook(
    rawPayload: string,
    headers: Record<string, string>,
  ): void {
    const secret = this.config.webhookSecret ?? this.config.secretKey;
    const receivedSignature =
      readHeader(headers, 'x-dlocal-signature') ??
      readHeader(headers, 'x-signature');

    if (!receivedSignature) {
      throw new WebhookVerificationError('Missing dLocal signature header.', {
        context: {
          provider: this.name,
        },
      });
    }

    const computedSignature = createHmacDigest('sha256', secret, rawPayload);
    if (!secureCompareHex(receivedSignature, computedSignature)) {
      throw new WebhookVerificationError(
        'dLocal webhook signature verification failed.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }
  }

  private async createPayment(
    request: ChargeRequest,
    authorizeOnly: boolean,
  ): Promise<PaymentResult> {
    const body: Record<string, unknown> = {
      amount: request.amount,
      currency: request.currency.toUpperCase(),
      capture: !authorizeOnly,
      description: request.description,
      metadata: request.metadata,
      country: request.customer?.address?.country,
      payer: {
        name: request.customer?.name,
        email: request.customer?.email,
        document: request.customer?.document,
      },
      ...mapPaymentMethod(request.paymentMethod),
    };

    const payment = await this.request<DLocalPayment>({
      operation: authorizeOnly ? 'authorize' : 'charge',
      path: '/v1/payments',
      method: 'POST',
      body,
    });

    return this.normalizePaymentResult(payment, request);
  }

  private normalizePaymentResult(
    payment: DLocalPayment,
    request?: ChargeRequest,
    fallbackId?: string,
  ): PaymentResult {
    const transactionId = payment.payment_id ?? payment.id ?? fallbackId;
    const status = mapDLocalStatus(payment.status);

    return {
      id: transactionId ?? `payment_${Date.now()}`,
      status,
      provider: this.name,
      providerId: payment.id ?? transactionId ?? `provider_${Date.now()}`,
      amount: payment.amount ?? request?.amount ?? 0,
      currency: (payment.currency ?? request?.currency ?? 'USD').toUpperCase(),
      paymentMethod: {
        type:
          payment.payment_method_id?.toLowerCase() ??
          request?.paymentMethod.type ??
          'card',
        last4: payment.card?.last4,
      },
      customer: request?.customer?.email
        ? {
            email: request.customer.email,
          }
        : undefined,
      metadata: request?.metadata ?? {},
      routing: {
        source: 'local',
        reason: 'dlocal adapter request',
      },
      createdAt: timestampOrNow(payment.created_date),
      providerMetadata: {
        dlocalStatus: payment.status,
        orderId: payment.order_id,
      },
    };
  }

  private buildHeaders(
    serializedBody: string,
    timestamp: string,
  ): Record<string, string> {
    const authPayload = `${this.config.xLogin}${timestamp}${serializedBody}`;
    const signature = createHmacDigest(
      'sha256',
      this.config.secretKey,
      authPayload,
    );

    return {
      'x-login': this.config.xLogin,
      'x-trans-key': this.config.xTransKey,
      'x-version': DLOCAL_API_VERSION,
      'x-date': timestamp,
      authorization: `V2-HMAC-SHA256, Signature: ${signature}`,
      'content-type': 'application/json',
    };
  }

  private async request<T>(params: {
    operation: string;
    path: string;
    method: 'GET' | 'POST';
    body?: Record<string, unknown>;
  }): Promise<T> {
    const serializedBody = params.body ? JSON.stringify(params.body) : '';
    return requestJson<T>({
      provider: this.name,
      fetchFn: this.config.fetchFn,
      baseUrl: this.config.baseUrl,
      path: params.path,
      method: params.method,
      timeoutMs: this.config.timeoutMs,
      headers: this.buildHeaders(serializedBody, new Date().toISOString()),
      body: params.body,
    }).catch((error) => {
      const record = asRecord(error);
      const hint = asRecord(record?.hint);
      const raw = asRecord(hint?.raw);
      throw {
        ...record,
        hint: {
          ...hint,
          providerCode:
            readString(hint, 'providerCode') ??
            readString(raw, 'code') ??
            readString(raw, 'error_code'),
          providerMessage:
            readString(hint, 'providerMessage') ??
            readString(raw, 'message') ??
            readString(record, 'message') ??
            'dLocal request failed.',
          httpStatus:
            readNumber(hint, 'httpStatus') ?? readNumber(record, 'status'),
          raw: error,
        },
        operation: params.operation,
      };
    });
  }
}
