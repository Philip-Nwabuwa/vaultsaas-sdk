import type { ProviderErrorHint } from '../../errors';

export type FetchLike = typeof fetch;

interface HttpRequestOptions {
  provider: string;
  fetchFn: FetchLike;
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  timeoutMs: number;
  headers?: Record<string, string>;
  body?: unknown;
}

type JsonValue = string | number | boolean | null;

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

function stringifyBody(body: unknown): string | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }

  if (typeof body === 'string') {
    return body;
  }

  return JSON.stringify(body);
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function encodeFormBody(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();

  function appendValue(prefix: string, value: unknown): void {
    if (value === undefined) {
      return;
    }

    if (value === null) {
      params.append(prefix, '');
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        appendValue(`${prefix}[${index}]`, item);
      });
      return;
    }

    if (typeof value === 'object') {
      for (const [key, nestedValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        appendValue(`${prefix}[${key}]`, nestedValue);
      }
      return;
    }

    const primitive = value as JsonValue;
    params.append(prefix, String(primitive));
  }

  for (const [key, value] of Object.entries(body)) {
    appendValue(key, value);
  }

  return params;
}

export function readHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) {
      return value;
    }
  }

  return undefined;
}

export async function requestJson<T>(options: HttpRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const url = `${options.baseUrl}${options.path}`;
  const serializedBody = stringifyBody(options.body);
  const headers = {
    ...(options.body !== undefined
      ? { 'content-type': 'application/json' }
      : {}),
    ...options.headers,
  };

  try {
    const response = await options.fetchFn(url, {
      method: options.method ?? 'GET',
      headers,
      body: serializedBody,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? parseJsonSafe(text) : null;

    if (!response.ok) {
      const payloadRecord = asRecord(payload);
      const errorRecord = asRecord(payloadRecord?.error) ?? payloadRecord;
      const hint: ProviderErrorHint = {
        httpStatus: response.status,
        providerCode:
          readString(errorRecord, 'code') ?? readString(payloadRecord, 'code'),
        providerMessage:
          readString(errorRecord, 'message') ??
          readString(payloadRecord, 'message') ??
          response.statusText,
        declineCode:
          readString(errorRecord, 'decline_code') ??
          readString(errorRecord, 'declineCode'),
        type: readString(errorRecord, 'type'),
        requestId:
          response.headers.get('request-id') ??
          response.headers.get('x-request-id') ??
          undefined,
        raw: payload,
      };

      throw {
        message:
          hint.providerMessage ??
          `Provider request failed with status ${response.status}.`,
        status: response.status,
        hint,
      };
    }

    if (!text) {
      return {} as T;
    }

    return payload as T;
  } catch (error) {
    const record = asRecord(error);
    const isAbortError = error instanceof Error && error.name === 'AbortError';
    const message =
      (error instanceof Error ? error.message : undefined) ??
      readString(record, 'message') ??
      'Provider request failed.';

    if (isAbortError) {
      throw {
        message: 'Request timed out.',
        code: 'ETIMEDOUT',
        hint: {
          httpStatus: readNumber(record, 'status'),
          providerMessage: message,
          isNetworkError: true,
          isTimeout: true,
          raw: error,
        } satisfies ProviderErrorHint,
      };
    }

    if (record && 'hint' in record) {
      throw error;
    }

    throw {
      message,
      hint: {
        providerMessage: message,
        isNetworkError: true,
        raw: error,
      } satisfies ProviderErrorHint,
    };
  } finally {
    clearTimeout(timeout);
  }
}
