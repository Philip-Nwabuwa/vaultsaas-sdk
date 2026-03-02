import { createHmac } from 'node:crypto';

export interface SignedWebhookPayload {
  payload: string;
  headers: Record<string, string>;
}

export type WebhookSigningProvider =
  | 'stripe'
  | 'dlocal'
  | 'paystack'
  | 'generic';

export interface SignedWebhookPayloadOptions {
  provider?: WebhookSigningProvider;
  timestamp?: number | string;
  headerName?: string;
}

function toPayloadString(payload: unknown): string {
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function createHmacDigest(
  algorithm: 'sha256' | 'sha512',
  secret: string,
  content: string,
): string {
  return createHmac(algorithm, secret).update(content).digest('hex');
}

export function createSignedWebhookPayload(
  payload: unknown,
  secret: string,
  options: SignedWebhookPayloadOptions = {},
): SignedWebhookPayload {
  const serialized = toPayloadString(payload);
  const provider = options.provider ?? 'generic';

  switch (provider) {
    case 'stripe': {
      const timestamp = String(
        options.timestamp ?? Math.floor(Date.now() / 1000),
      );
      const signature = createHmacDigest(
        'sha256',
        secret,
        `${timestamp}.${serialized}`,
      );
      const headerName = options.headerName ?? 'stripe-signature';
      return {
        payload: serialized,
        headers: {
          [headerName]: `t=${timestamp},v1=${signature}`,
        },
      };
    }
    case 'dlocal': {
      const signature = createHmacDigest('sha256', secret, serialized);
      const headerName = options.headerName ?? 'x-dlocal-signature';
      return {
        payload: serialized,
        headers: {
          [headerName]: signature,
        },
      };
    }
    case 'paystack': {
      const signature = createHmacDigest('sha512', secret, serialized);
      const headerName = options.headerName ?? 'x-paystack-signature';
      return {
        payload: serialized,
        headers: {
          [headerName]: signature,
        },
      };
    }
    case 'generic': {
      const signature = createHmacDigest('sha256', secret, serialized);
      const headerName = options.headerName ?? 'x-vault-test-signature';
      return {
        payload: serialized,
        headers: {
          [headerName]: signature,
        },
      };
    }
    default: {
      const unsupportedProvider: never = provider;
      throw new Error(
        `Unsupported webhook signing provider: ${unsupportedProvider}`,
      );
    }
  }
}

export function createStripeSignedWebhookPayload(
  payload: unknown,
  secret: string,
  options: Omit<SignedWebhookPayloadOptions, 'provider'> = {},
): SignedWebhookPayload {
  return createSignedWebhookPayload(payload, secret, {
    ...options,
    provider: 'stripe',
  });
}

export function createDLocalSignedWebhookPayload(
  payload: unknown,
  secret: string,
  options: Omit<SignedWebhookPayloadOptions, 'provider'> = {},
): SignedWebhookPayload {
  return createSignedWebhookPayload(payload, secret, {
    ...options,
    provider: 'dlocal',
  });
}

export function createPaystackSignedWebhookPayload(
  payload: unknown,
  secret: string,
  options: Omit<SignedWebhookPayloadOptions, 'provider'> = {},
): SignedWebhookPayload {
  return createSignedWebhookPayload(payload, secret, {
    ...options,
    provider: 'paystack',
  });
}
