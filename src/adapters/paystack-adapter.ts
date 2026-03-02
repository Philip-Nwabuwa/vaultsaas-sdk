import {
  VaultConfigError,
  VaultProviderError,
  WebhookVerificationError,
} from '../errors';
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

const DEFAULT_PAYSTACK_BASE_URL = 'https://api.paystack.co';
const DEFAULT_TIMEOUT_MS = 15_000;

interface PaystackAdapterConfig {
  secretKey: string;
  webhookSecret?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

interface PaystackTransaction {
  id?: number;
  reference?: string;
  status?: string;
  amount?: number;
  currency?: string;
  paid_at?: string;
  created_at?: string;
  gateway_response?: string;
  authorization?: {
    authorization_code?: string;
    last4?: string;
    brand?: string;
    exp_month?: string;
    exp_year?: string;
  };
  customer?: {
    email?: string;
  };
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

interface PaystackRefund {
  id?: number;
  transaction?: number;
  status?: string;
  amount?: number;
  currency?: string;
  created_at?: string;
  reason?: string;
  [key: string]: unknown;
}

interface PaystackWebhookPayload {
  event?: string;
  data?: Record<string, unknown>;
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

function mapPaystackPaymentStatus(
  status: string | undefined,
): PaymentResult['status'] {
  switch (status?.toLowerCase()) {
    case 'success':
      return 'completed';
    case 'pending':
    case 'ongoing':
    case 'queued':
      return 'pending';
    case 'abandoned':
      return 'cancelled';
    case 'failed':
    case 'reversed':
      return 'failed';
    default:
      return 'failed';
  }
}

function mapPaystackRefundStatus(
  status: string | undefined,
): RefundResult['status'] {
  switch (status?.toLowerCase()) {
    case 'processed':
    case 'success':
      return 'completed';
    case 'pending':
      return 'pending';
    default:
      return 'failed';
  }
}

function mapPaystackEventType(event?: string): VaultEvent['type'] {
  switch (event) {
    case 'charge.success':
      return 'payment.completed';
    case 'charge.failed':
      return 'payment.failed';
    case 'charge.pending':
      return 'payment.pending';
    case 'refund.processed':
    case 'refund.success':
      return 'payment.refunded';
    case 'refund.pending':
      return 'payment.partially_refunded';
    case 'dispute.create':
    case 'charge.dispute.create':
      return 'payment.disputed';
    case 'dispute.resolve':
    case 'charge.dispute.resolve':
      return 'payment.dispute_resolved';
    case 'transfer.success':
      return 'payout.completed';
    case 'transfer.failed':
      return 'payout.failed';
    default:
      return 'payment.failed';
  }
}

function mapPaymentMethod(
  paymentMethod: PaymentMethodInput,
): Record<string, unknown> {
  if (paymentMethod.type === 'card' && 'token' in paymentMethod) {
    return {
      authorization_code: paymentMethod.token,
    };
  }

  if (paymentMethod.type === 'card') {
    return {
      card: {
        number: paymentMethod.number,
        cvv: paymentMethod.cvc,
        expiry_month: String(paymentMethod.expMonth).padStart(2, '0'),
        expiry_year: String(paymentMethod.expYear),
      },
    };
  }

  if (paymentMethod.type === 'bank_transfer') {
    return {
      bank: {
        code: paymentMethod.bankCode,
        account_number: paymentMethod.accountNumber,
      },
    };
  }

  if (paymentMethod.type === 'wallet') {
    return {
      mobile_money: {
        provider: paymentMethod.walletType,
        token: paymentMethod.token,
      },
    };
  }

  return {
    channel: paymentMethod.type,
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

export class PaystackAdapter implements PaymentAdapter {
  readonly name = 'paystack';
  static readonly supportedMethods = [
    'card',
    'bank_transfer',
    'wallet',
  ] as const;
  static readonly supportedCurrencies = [
    'NGN',
    'GHS',
    'ZAR',
    'KES',
    'USD',
  ] as const;
  static readonly supportedCountries = ['NG', 'GH', 'ZA', 'KE'] as const;
  readonly metadata = {
    supportedMethods: PaystackAdapter.supportedMethods,
    supportedCurrencies: PaystackAdapter.supportedCurrencies,
    supportedCountries: PaystackAdapter.supportedCountries,
  };
  private readonly config: Required<
    Pick<
      PaystackAdapterConfig,
      'secretKey' | 'baseUrl' | 'timeoutMs' | 'fetchFn'
    >
  > &
    Pick<PaystackAdapterConfig, 'webhookSecret'>;

  constructor(rawConfig: Record<string, unknown>) {
    const secretKey =
      typeof rawConfig.secretKey === 'string' ? rawConfig.secretKey.trim() : '';
    if (!secretKey) {
      throw new VaultConfigError(
        'Paystack adapter requires config.secretKey.',
        {
          code: 'INVALID_CONFIGURATION',
          context: {
            provider: 'paystack',
          },
        },
      );
    }

    const baseUrl =
      typeof rawConfig.baseUrl === 'string' && rawConfig.baseUrl.trim()
        ? rawConfig.baseUrl.trim()
        : DEFAULT_PAYSTACK_BASE_URL;
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
    const payload = this.buildChargePayload(request, false);
    const transaction = await this.request<PaystackTransaction>({
      operation: 'charge',
      path: '/charge',
      method: 'POST',
      body: payload,
    });

    return this.normalizePaymentResult(transaction, request);
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    const payload = this.buildChargePayload(request, true);
    const transaction = await this.request<PaystackTransaction>({
      operation: 'authorize',
      path: '/charge',
      method: 'POST',
      body: payload,
    });

    return this.normalizePaymentResult(transaction, request);
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    const current = await this.request<PaystackTransaction>({
      operation: 'capture.verify',
      path: `/transaction/verify/${request.transactionId}`,
      method: 'GET',
    });
    const authorizationCode = current.authorization?.authorization_code;
    const email = current.customer?.email;
    if (!authorizationCode || !email) {
      throw new VaultProviderError(
        'Paystack capture requires an authorization code and customer email.',
        {
          code: 'INVALID_REQUEST',
          context: {
            provider: this.name,
            operation: 'capture',
          },
        },
      );
    }

    const charged = await this.request<PaystackTransaction>({
      operation: 'capture',
      path: '/transaction/charge_authorization',
      method: 'POST',
      body: {
        authorization_code: authorizationCode,
        email,
        amount: request.amount ?? current.amount,
        currency: current.currency,
      },
    });

    return this.normalizePaymentResult(charged);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const refund = await this.request<PaystackRefund>({
      operation: 'refund',
      path: '/refund',
      method: 'POST',
      body: {
        transaction: request.transactionId,
        amount: request.amount,
      },
    });

    return {
      id: String(refund.id ?? `refund_${Date.now()}`),
      transactionId: String(refund.transaction ?? request.transactionId),
      status: mapPaystackRefundStatus(refund.status),
      amount: refund.amount ?? request.amount ?? 0,
      currency: (refund.currency ?? 'NGN').toUpperCase(),
      provider: this.name,
      providerId: String(refund.id ?? request.transactionId),
      reason: refund.reason ?? request.reason,
      createdAt: timestampOrNow(refund.created_at),
    };
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    const refund = await this.refund({
      transactionId: request.transactionId,
      reason: 'void',
    });

    return {
      id: `void_${refund.id}`,
      transactionId: request.transactionId,
      status: refund.status === 'completed' ? 'completed' : 'failed',
      provider: this.name,
      createdAt: refund.createdAt,
    };
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    const transaction = await this.request<PaystackTransaction>({
      operation: 'getStatus',
      path: `/transaction/verify/${transactionId}`,
      method: 'GET',
    });

    const status = mapPaystackPaymentStatus(transaction.status);
    const timestamp = timestampOrNow(
      transaction.paid_at ?? transaction.created_at,
    );

    return {
      id: transaction.reference ?? transactionId,
      status,
      provider: this.name,
      providerId: String(
        transaction.id ?? transaction.reference ?? transactionId,
      ),
      amount: transaction.amount ?? 0,
      currency: (transaction.currency ?? 'NGN').toUpperCase(),
      history: [
        {
          status,
          timestamp,
          reason: transaction.gateway_response,
        },
      ],
      updatedAt: timestamp,
    };
  }

  async listPaymentMethods(
    country: string,
    currency: string,
  ): Promise<PaymentMethodInfo[]> {
    return [
      {
        type: 'card',
        provider: this.name,
        name: 'Paystack Card',
        countries: [country],
        currencies: [currency.toUpperCase()],
      },
      {
        type: 'bank_transfer',
        provider: this.name,
        name: 'Paystack Bank Transfer',
        countries: ['NG', 'GH', 'ZA', 'KE'],
        currencies: ['NGN', 'GHS', 'ZAR', 'KES'],
      },
    ];
  }

  async handleWebhook(
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<VaultEvent> {
    const rawPayload = toRawString(payload);
    this.verifyWebhook(rawPayload, headers);

    let parsed: PaystackWebhookPayload;
    try {
      parsed = JSON.parse(rawPayload) as PaystackWebhookPayload;
    } catch {
      throw new WebhookVerificationError(
        'Paystack webhook payload is not valid JSON.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }

    const data = asRecord(parsed.data);
    const providerEventId =
      readString(data, 'id') ??
      readString(data, 'reference') ??
      `evt_${Date.now()}`;

    return normalizeWebhookEvent(
      this.name,
      {
        id: providerEventId,
        providerEventId,
        type: mapPaystackEventType(parsed.event),
        transactionId:
          readString(data, 'reference') ??
          (typeof readNumber(data, 'id') === 'number'
            ? String(readNumber(data, 'id'))
            : undefined),
        data: data ?? {},
        timestamp: timestampOrNow(readString(data, 'created_at')),
      },
      parsed,
    );
  }

  private verifyWebhook(
    rawPayload: string,
    headers: Record<string, string>,
  ): void {
    const signature = readHeader(headers, 'x-paystack-signature');
    if (!signature) {
      throw new WebhookVerificationError('Missing Paystack signature header.', {
        context: {
          provider: this.name,
        },
      });
    }

    const secret = this.config.webhookSecret ?? this.config.secretKey;
    const computed = createHmacDigest('sha512', secret, rawPayload);
    if (!secureCompareHex(signature, computed)) {
      throw new WebhookVerificationError(
        'Paystack webhook signature verification failed.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }
  }

  private buildChargePayload(
    request: ChargeRequest,
    authorizeOnly: boolean,
  ): Record<string, unknown> {
    const email = request.customer?.email;
    if (!email) {
      throw new VaultProviderError(
        'Paystack charge requires customer.email in the request.',
        {
          code: 'INVALID_REQUEST',
          context: {
            provider: this.name,
            operation: authorizeOnly ? 'authorize' : 'charge',
          },
        },
      );
    }

    return {
      email,
      amount: request.amount,
      currency: request.currency.toUpperCase(),
      metadata: {
        ...(request.metadata ?? {}),
        vaultsaas_intent: authorizeOnly ? 'authorize' : 'charge',
      },
      ...mapPaymentMethod(request.paymentMethod),
    };
  }

  private normalizePaymentResult(
    transaction: PaystackTransaction,
    request?: ChargeRequest,
  ): PaymentResult {
    const id =
      transaction.reference ?? String(transaction.id ?? `txn_${Date.now()}`);
    return {
      id,
      status: mapPaystackPaymentStatus(transaction.status),
      provider: this.name,
      providerId: String(transaction.id ?? id),
      amount: transaction.amount ?? request?.amount ?? 0,
      currency: (
        transaction.currency ??
        request?.currency ??
        'NGN'
      ).toUpperCase(),
      paymentMethod: {
        type: request?.paymentMethod.type ?? 'card',
        last4: transaction.authorization?.last4,
        brand: transaction.authorization?.brand,
        expiryMonth: transaction.authorization?.exp_month
          ? Number(transaction.authorization.exp_month)
          : undefined,
        expiryYear: transaction.authorization?.exp_year
          ? Number(transaction.authorization.exp_year)
          : undefined,
      },
      customer:
        transaction.customer?.email || request?.customer?.email
          ? {
              email: transaction.customer?.email ?? request?.customer?.email,
            }
          : undefined,
      metadata: transaction.metadata ?? request?.metadata ?? {},
      routing: {
        source: 'local',
        reason: 'paystack adapter request',
      },
      createdAt: timestampOrNow(transaction.paid_at ?? transaction.created_at),
      providerMetadata: {
        paystackStatus: transaction.status,
        gatewayResponse: transaction.gateway_response,
      },
    };
  }

  private async request<T>(params: {
    operation: string;
    path: string;
    method: 'GET' | 'POST';
    body?: Record<string, unknown>;
  }): Promise<T> {
    const envelope = await requestJson<PaystackEnvelope<T>>({
      provider: this.name,
      fetchFn: this.config.fetchFn,
      baseUrl: this.config.baseUrl,
      path: params.path,
      method: params.method,
      timeoutMs: this.config.timeoutMs,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
      },
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
            readString(hint, 'providerCode') ?? readString(raw, 'code'),
          providerMessage:
            readString(hint, 'providerMessage') ??
            readString(raw, 'message') ??
            readString(record, 'message') ??
            'Paystack request failed.',
          httpStatus:
            readNumber(hint, 'httpStatus') ?? readNumber(record, 'status'),
          raw: error,
        },
        operation: params.operation,
      };
    });

    if (!envelope.status) {
      throw {
        message: envelope.message || 'Paystack rejected the request.',
        hint: {
          providerMessage: envelope.message,
          providerCode: 'paystack_error',
          raw: envelope,
        },
        operation: params.operation,
      };
    }

    return envelope.data;
  }
}
