import {
  VaultError,
  VaultNetworkError,
  VaultProviderError,
} from './vault-error';

/** Optional provider-side fields used to improve error classification. */
export interface ProviderErrorHint {
  providerCode?: string;
  providerMessage?: string;
  requestId?: string;
  httpStatus?: number;
  declineCode?: string;
  type?: string;
  isNetworkError?: boolean;
  isTimeout?: boolean;
  raw?: unknown;
}

/** Context attached to mapped provider errors. */
export interface ProviderErrorMappingContext {
  provider: string;
  operation: string;
}

interface ExtractedProviderError {
  message: string;
  providerCode?: string;
  providerMessage?: string;
  requestId?: string;
  httpStatus?: number;
  declineCode?: string;
  type?: string;
  errorCode?: string;
  isNetworkError: boolean;
  isTimeout: boolean;
  raw?: unknown;
}

interface ClassificationResult {
  code: string;
}

const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const CARD_DECLINED_PATTERNS = [
  /card[\s_-]?declined/i,
  /insufficient[\s_-]?funds/i,
  /do[\s_-]?not[\s_-]?honou?r/i,
  /generic[\s_-]?decline/i,
];

const AUTHENTICATION_REQUIRED_PATTERNS = [
  /\b3ds\b/i,
  /authentication[\s_-]?required/i,
  /requires[\s_-]?action/i,
  /challenge[\s_-]?required/i,
];

const FRAUD_PATTERNS = [
  /fraud/i,
  /risk[\s_-]?check/i,
  /suspected/i,
  /blocked[\s_-]?for[\s_-]?risk/i,
];

const INVALID_REQUEST_PATTERNS = [
  /invalid[\s_-]?request/i,
  /missing required/i,
  /malformed/i,
  /validation/i,
];

const RATE_LIMIT_PATTERNS = [/rate[\s_-]?limit/i, /too many requests/i];

const AUTH_FAILED_PATTERNS = [
  /invalid[\s_-]?api[\s_-]?key/i,
  /unauthorized/i,
  /authentication failed/i,
  /forbidden/i,
];

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

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function isProviderErrorHint(
  value: unknown,
): value is ProviderErrorHint {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  return (
    typeof record.providerCode === 'string' ||
    typeof record.providerMessage === 'string' ||
    typeof record.requestId === 'string' ||
    typeof record.httpStatus === 'number' ||
    typeof record.declineCode === 'string' ||
    typeof record.type === 'string' ||
    typeof record.isNetworkError === 'boolean' ||
    typeof record.isTimeout === 'boolean' ||
    'raw' in record
  );
}

function extractHint(source: unknown): ProviderErrorHint | undefined {
  if (isProviderErrorHint(source)) {
    return source;
  }

  const record = asRecord(source);
  if (!record) {
    return undefined;
  }

  const hint = record.hint;
  if (isProviderErrorHint(hint)) {
    return hint;
  }

  const providerError = record.providerError;
  if (isProviderErrorHint(providerError)) {
    return providerError;
  }

  return undefined;
}

function extractProviderError(error: unknown): ExtractedProviderError {
  const record = asRecord(error);
  const hint = extractHint(error);
  const response = asRecord(record?.response);
  const responseData = asRecord(response?.data);
  const responseError = asRecord(responseData?.error);

  const providerCode =
    hint?.providerCode ??
    readString(record, 'providerCode') ??
    readString(responseError, 'code') ??
    readString(responseData, 'code');
  const providerMessage =
    hint?.providerMessage ??
    readString(record, 'providerMessage') ??
    readString(responseError, 'message') ??
    readString(responseData, 'message');
  const requestId =
    hint?.requestId ??
    readString(record, 'requestId') ??
    readString(response, 'requestId');
  const httpStatus =
    hint?.httpStatus ??
    readNumber(record, 'status') ??
    readNumber(record, 'statusCode') ??
    readNumber(response, 'status');
  const declineCode =
    hint?.declineCode ??
    readString(record, 'declineCode') ??
    readString(responseError, 'declineCode') ??
    readString(responseData, 'declineCode');
  const type =
    hint?.type ??
    readString(record, 'type') ??
    readString(responseError, 'type') ??
    readString(responseData, 'type');

  const message =
    providerMessage ??
    (error instanceof Error ? error.message : undefined) ??
    readString(record, 'message') ??
    'Provider operation failed.';
  const errorCode =
    readString(record, 'code') ??
    readString(responseError, 'code') ??
    readString(responseData, 'code');

  const errorCodeUpper = errorCode?.toUpperCase();
  const textBlob = [message, providerMessage, providerCode, declineCode, type]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  const isTimeout =
    hint?.isTimeout ??
    (errorCodeUpper === 'ETIMEDOUT' || /timeout|timed out/i.test(textBlob));
  const isNetworkError =
    hint?.isNetworkError ??
    (isTimeout ||
      (errorCodeUpper ? NETWORK_ERROR_CODES.has(errorCodeUpper) : false) ||
      /network|socket|dns|connection reset|connection refused/i.test(textBlob));

  return {
    message,
    providerCode,
    providerMessage,
    requestId,
    httpStatus,
    declineCode,
    type,
    errorCode,
    isNetworkError,
    isTimeout,
    raw: hint?.raw ?? responseData ?? error,
  };
}

function classifyProviderError(
  details: ExtractedProviderError,
): ClassificationResult {
  const textBlob = [
    details.message,
    details.providerMessage,
    details.providerCode,
    details.declineCode,
    details.type,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');

  if (details.httpStatus === 429 || matchAny(textBlob, RATE_LIMIT_PATTERNS)) {
    return { code: 'RATE_LIMITED' };
  }

  if (
    details.httpStatus === 401 ||
    details.httpStatus === 403 ||
    matchAny(textBlob, AUTH_FAILED_PATTERNS)
  ) {
    return { code: 'PROVIDER_AUTH_FAILED' };
  }

  if (matchAny(textBlob, AUTHENTICATION_REQUIRED_PATTERNS)) {
    return { code: 'AUTHENTICATION_REQUIRED' };
  }

  if (matchAny(textBlob, FRAUD_PATTERNS)) {
    return { code: 'FRAUD_SUSPECTED' };
  }

  if (matchAny(textBlob, CARD_DECLINED_PATTERNS)) {
    return { code: 'CARD_DECLINED' };
  }

  if (
    details.httpStatus === 400 ||
    details.httpStatus === 404 ||
    details.httpStatus === 409 ||
    details.httpStatus === 422 ||
    matchAny(textBlob, INVALID_REQUEST_PATTERNS)
  ) {
    return { code: 'INVALID_REQUEST' };
  }

  if (details.httpStatus !== undefined && details.httpStatus >= 500) {
    return { code: 'PROVIDER_ERROR' };
  }

  return { code: 'PROVIDER_UNKNOWN' };
}

/** Normalizes unknown provider errors into Vault error classes with stable codes. */
export function mapProviderError(
  error: unknown,
  mappingContext: ProviderErrorMappingContext,
): VaultError {
  if (error instanceof VaultError) {
    return error;
  }

  const details = extractProviderError(error);
  const context = {
    provider: mappingContext.provider,
    operation: mappingContext.operation,
    providerCode: details.providerCode,
    providerMessage: details.providerMessage ?? details.message,
    requestId: details.requestId,
    httpStatus: details.httpStatus,
    declineCode: details.declineCode,
    errorCode: details.errorCode,
    raw: details.raw,
  };

  if (details.isNetworkError) {
    return new VaultNetworkError(details.message, {
      code: details.isTimeout ? 'PROVIDER_TIMEOUT' : 'NETWORK_ERROR',
      context,
    });
  }

  const classification = classifyProviderError(details);
  return new VaultProviderError(details.message, {
    code: classification.code,
    context,
  });
}
