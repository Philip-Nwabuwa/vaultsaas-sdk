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
import { encodeFormBody, readHeader, requestJson } from './shared/http';
import {
  createHmacDigest,
  secureCompareHex,
  toRawString,
} from './shared/signature';

const DEFAULT_STRIPE_BASE_URL = 'https://api.stripe.com';
const DEFAULT_TIMEOUT_MS = 15_000;

interface StripeAdapterConfig {
  apiKey: string;
  webhookSecret?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  created?: number;
  latest_charge?: string;
  metadata?: Record<string, string>;
  payment_method?: string;
  payment_method_types?: string[];
}

interface StripeRefund {
  id: string;
  payment_intent?: string;
  charge?: string;
  status: string;
  amount: number;
  currency: string;
  reason?: string;
  created?: number;
}

interface StripeWebhookEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: {
    object?: Record<string, unknown>;
  };
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

function toIsoTimestamp(unixSeconds?: number): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) {
    return new Date().toISOString();
  }

  return new Date(unixSeconds * 1000).toISOString();
}

function mapStripeStatus(status: string): PaymentResult['status'] {
  switch (status) {
    case 'succeeded':
      return 'completed';
    case 'requires_capture':
      return 'authorized';
    case 'requires_action':
      return 'requires_action';
    case 'processing':
      return 'pending';
    case 'canceled':
      return 'cancelled';
    case 'requires_payment_method':
      return 'declined';
    case 'requires_confirmation':
      return 'pending';
    default:
      return 'failed';
  }
}

function mapRefundStatus(status: string): RefundResult['status'] {
  switch (status) {
    case 'succeeded':
      return 'completed';
    case 'pending':
      return 'pending';
    default:
      return 'failed';
  }
}

function buildStripePaymentMethodData(
  paymentMethod: PaymentMethodInput,
): Record<string, unknown> {
  if (paymentMethod.type === 'card' && 'token' in paymentMethod) {
    return {
      payment_method: paymentMethod.token,
      payment_method_types: ['card'],
    };
  }

  if (paymentMethod.type === 'card') {
    return {
      payment_method_data: {
        type: 'card',
        card: {
          number: paymentMethod.number,
          exp_month: paymentMethod.expMonth,
          exp_year: paymentMethod.expYear,
          cvc: paymentMethod.cvc,
        },
      },
      payment_method_types: ['card'],
    };
  }

  if (paymentMethod.type === 'wallet') {
    return {
      payment_method_types: [paymentMethod.walletType],
      payment_method_data: {
        type: paymentMethod.walletType,
        wallet: {
          token: paymentMethod.token,
        },
      },
    };
  }

  if (paymentMethod.type === 'bank_transfer') {
    return {
      payment_method_types: ['customer_balance'],
      payment_method_data: {
        type: 'customer_balance',
        customer_balance: {
          funding_type: 'bank_transfer',
        },
      },
    };
  }

  return {
    payment_method_types: [paymentMethod.type],
  };
}

function extractPaymentMethodSnapshot(
  request: ChargeRequest | undefined,
  intent: StripePaymentIntent,
): PaymentResult['paymentMethod'] {
  if (
    request?.paymentMethod.type === 'card' &&
    'number' in request.paymentMethod
  ) {
    return {
      type: 'card',
      last4: request.paymentMethod.number.slice(-4),
      expiryMonth: request.paymentMethod.expMonth,
      expiryYear: request.paymentMethod.expYear,
    };
  }

  if (
    request?.paymentMethod.type === 'card' &&
    'token' in request.paymentMethod
  ) {
    return {
      type: 'card',
    };
  }

  if (request) {
    return {
      type: request.paymentMethod.type,
    };
  }

  return {
    type: intent.payment_method_types?.[0] ?? 'card',
  };
}

function mapStripeEventType(type?: string): VaultEvent['type'] {
  switch (type) {
    case 'payment_intent.succeeded':
      return 'payment.completed';
    case 'payment_intent.payment_failed':
      return 'payment.failed';
    case 'payment_intent.processing':
      return 'payment.pending';
    case 'payment_intent.requires_action':
      return 'payment.requires_action';
    case 'charge.refunded':
      return 'payment.refunded';
    case 'charge.dispute.created':
      return 'payment.disputed';
    case 'charge.dispute.closed':
      return 'payment.dispute_resolved';
    case 'payout.paid':
      return 'payout.completed';
    case 'payout.failed':
      return 'payout.failed';
    default:
      return 'payment.failed';
  }
}

function extractStripeTransactionId(
  webhook: StripeWebhookEvent,
): string | undefined {
  const object = asRecord(webhook.data?.object);
  return (
    readString(object, 'payment_intent') ??
    readString(object, 'id') ??
    readString(object, 'charge')
  );
}

export class StripeAdapter implements PaymentAdapter {
  readonly name = 'stripe';
  private readonly config: Required<
    Pick<StripeAdapterConfig, 'apiKey' | 'baseUrl' | 'timeoutMs' | 'fetchFn'>
  > &
    Pick<StripeAdapterConfig, 'webhookSecret'>;

  constructor(rawConfig: Record<string, unknown>) {
    const apiKey =
      typeof rawConfig.apiKey === 'string' ? rawConfig.apiKey.trim() : '';
    if (!apiKey) {
      throw new VaultConfigError('Stripe adapter requires config.apiKey.', {
        code: 'INVALID_CONFIGURATION',
        context: {
          provider: 'stripe',
        },
      });
    }

    const baseUrl =
      typeof rawConfig.baseUrl === 'string' && rawConfig.baseUrl.trim()
        ? rawConfig.baseUrl.trim()
        : DEFAULT_STRIPE_BASE_URL;
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
      apiKey,
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
    return this.createPaymentIntent(request, 'automatic');
  }

  async authorize(request: AuthorizeRequest): Promise<PaymentResult> {
    return this.createPaymentIntent(request, 'manual');
  }

  async capture(request: CaptureRequest): Promise<PaymentResult> {
    const body: Record<string, unknown> = {};
    if (request.amount !== undefined) {
      body.amount_to_capture = request.amount;
    }

    const intent = await this.postForm<StripePaymentIntent>(
      `/v1/payment_intents/${request.transactionId}/capture`,
      body,
      'capture',
    );

    return this.normalizePaymentResult(intent);
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const body: Record<string, unknown> = {
      payment_intent: request.transactionId,
    };
    if (request.amount !== undefined) {
      body.amount = request.amount;
    }
    if (request.reason) {
      body.reason = request.reason;
    }

    const refund = await this.postForm<StripeRefund>(
      '/v1/refunds',
      body,
      'refund',
    );

    return {
      id: refund.id,
      transactionId: refund.payment_intent ?? request.transactionId,
      status: mapRefundStatus(refund.status),
      amount: refund.amount,
      currency: refund.currency.toUpperCase(),
      provider: this.name,
      providerId: refund.charge ?? refund.id,
      reason: refund.reason,
      createdAt: toIsoTimestamp(refund.created),
    };
  }

  async void(request: VoidRequest): Promise<VoidResult> {
    const intent = await this.postForm<StripePaymentIntent>(
      `/v1/payment_intents/${request.transactionId}/cancel`,
      {},
      'void',
    );

    return {
      id: `void_${intent.id}`,
      transactionId: request.transactionId,
      status: intent.status === 'canceled' ? 'completed' : 'failed',
      provider: this.name,
      createdAt: toIsoTimestamp(intent.created),
    };
  }

  async getStatus(transactionId: string): Promise<TransactionStatus> {
    const intent = await this.get<StripePaymentIntent>(
      `/v1/payment_intents/${transactionId}`,
      'getStatus',
    );

    const status = mapStripeStatus(intent.status);
    const timestamp = toIsoTimestamp(intent.created);

    return {
      id: intent.id,
      status,
      provider: this.name,
      providerId: intent.latest_charge ?? intent.id,
      amount: intent.amount,
      currency: intent.currency.toUpperCase(),
      history: [
        {
          status,
          timestamp,
          reason: `stripe status: ${intent.status}`,
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
        name: 'Stripe Card',
        countries: [country],
        currencies: [currency.toUpperCase()],
      },
      {
        type: 'wallet',
        provider: this.name,
        name: 'Stripe Wallets',
        countries: [country],
        currencies: [currency.toUpperCase()],
      },
    ];
  }

  async handleWebhook(
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<VaultEvent> {
    const rawPayload = toRawString(payload);
    this.verifyWebhook(rawPayload, headers);

    let parsed: StripeWebhookEvent;
    try {
      parsed = JSON.parse(rawPayload) as StripeWebhookEvent;
    } catch {
      throw new WebhookVerificationError(
        'Stripe webhook payload is not valid JSON.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }

    const transactionId = extractStripeTransactionId(parsed);
    const providerEventId = parsed.id ?? `evt_${Date.now()}`;

    return normalizeWebhookEvent(
      this.name,
      {
        id: providerEventId,
        providerEventId,
        type: mapStripeEventType(parsed.type),
        transactionId,
        data: asRecord(parsed.data?.object) ?? {},
        timestamp: toIsoTimestamp(parsed.created),
      },
      parsed,
    );
  }

  private verifyWebhook(
    rawPayload: string,
    headers: Record<string, string>,
  ): void {
    if (!this.config.webhookSecret) {
      throw new WebhookVerificationError(
        'Stripe webhook secret is not configured.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }

    const signature = readHeader(headers, 'stripe-signature');
    if (!signature) {
      throw new WebhookVerificationError('Missing Stripe signature header.', {
        context: {
          provider: this.name,
        },
      });
    }

    const components = signature.split(',').map((part) => part.trim());
    let timestamp: string | undefined;
    const signatures: string[] = [];
    for (const component of components) {
      const [key, value] = component.split('=');
      if (!key || !value) {
        continue;
      }

      if (key === 't') {
        timestamp = value;
      } else if (key === 'v1') {
        signatures.push(value);
      }
    }

    if (!timestamp || signatures.length === 0) {
      throw new WebhookVerificationError(
        'Stripe signature header is malformed.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }

    const computed = createHmacDigest(
      'sha256',
      this.config.webhookSecret,
      `${timestamp}.${rawPayload}`,
    );
    const verified = signatures.some((item) =>
      secureCompareHex(item, computed),
    );
    if (!verified) {
      throw new WebhookVerificationError(
        'Stripe webhook signature verification failed.',
        {
          context: {
            provider: this.name,
          },
        },
      );
    }
  }

  private async createPaymentIntent(
    request: ChargeRequest,
    captureMethod: 'automatic' | 'manual',
  ): Promise<PaymentResult> {
    const body: Record<string, unknown> = {
      amount: request.amount,
      currency: request.currency.toLowerCase(),
      confirm: true,
      capture_method: captureMethod,
      metadata: request.metadata ?? {},
      ...buildStripePaymentMethodData(request.paymentMethod),
    };

    if (request.description) {
      body.description = request.description;
    }

    if (request.customer?.email) {
      body.receipt_email = request.customer.email;
    }

    if (request.customer?.name) {
      body['shipping[name]'] = request.customer.name;
    }

    const intent = await this.postForm<StripePaymentIntent>(
      '/v1/payment_intents',
      body,
      captureMethod === 'manual' ? 'authorize' : 'charge',
    );

    return this.normalizePaymentResult(intent, request);
  }

  private normalizePaymentResult(
    intent: StripePaymentIntent,
    request?: ChargeRequest,
  ): PaymentResult {
    return {
      id: intent.id,
      status: mapStripeStatus(intent.status),
      provider: this.name,
      providerId: intent.latest_charge ?? intent.id,
      amount: intent.amount,
      currency: intent.currency.toUpperCase(),
      paymentMethod: extractPaymentMethodSnapshot(request, intent),
      customer: request?.customer?.email
        ? {
            email: request.customer.email,
          }
        : undefined,
      metadata: {
        ...(request?.metadata ?? {}),
        ...(intent.metadata ?? {}),
      },
      routing: {
        source: 'local',
        reason: 'stripe adapter request',
      },
      createdAt: toIsoTimestamp(intent.created),
      providerMetadata: {
        stripeStatus: intent.status,
        paymentMethod: intent.payment_method,
      },
    };
  }

  private async get<T>(path: string, operation: string): Promise<T> {
    return requestJson<T>({
      provider: this.name,
      fetchFn: this.config.fetchFn,
      baseUrl: this.config.baseUrl,
      path,
      method: 'GET',
      timeoutMs: this.config.timeoutMs,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    }).catch((error) => {
      throw {
        ...asRecord(error),
        hint: {
          ...(asRecord(asRecord(error)?.hint) ?? {}),
          providerMessage:
            readString(asRecord(error), 'message') ?? 'Stripe request failed.',
          raw: error,
        },
        operation,
      };
    });
  }

  private async postForm<T>(
    path: string,
    body: Record<string, unknown>,
    operation: string,
  ): Promise<T> {
    const formBody = encodeFormBody(body);
    const payload = formBody.toString();
    return requestJson<T>({
      provider: this.name,
      fetchFn: this.config.fetchFn,
      baseUrl: this.config.baseUrl,
      path,
      method: 'POST',
      timeoutMs: this.config.timeoutMs,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    }).catch((error) => {
      const record = asRecord(error);
      const hint = asRecord(record?.hint);
      throw {
        ...record,
        hint: {
          ...hint,
          providerCode:
            readString(hint, 'providerCode') ??
            readString(record, 'providerCode'),
          providerMessage:
            readString(hint, 'providerMessage') ??
            readString(record, 'message') ??
            'Stripe request failed.',
          declineCode:
            readString(hint, 'declineCode') ??
            readString(asRecord(hint?.raw), 'decline_code'),
          raw: error,
        },
        operation,
      };
    });
  }
}
