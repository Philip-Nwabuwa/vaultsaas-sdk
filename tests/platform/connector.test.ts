import { describe, expect, it, vi } from 'vitest';
import { PlatformConnector } from '../../src/platform';

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('PlatformConnector', () => {
  it('calls routing decision endpoint', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      createJsonResponse({
        provider: 'dlocal',
        reason: 'best approval score',
        decisionId: 'dec_123',
      }),
    );
    const connector = new PlatformConnector({
      apiKey: 'pk_test_123',
      baseUrl: 'https://platform.test',
      fetchFn,
      flushIntervalMs: 60_000,
    });

    const decision = await connector.decideRouting({
      currency: 'USD',
      amount: 1000,
      paymentMethod: 'card',
      country: 'US',
    });

    connector.close();

    expect(decision?.provider).toBe('dlocal');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'https://platform.test/v1/routing/decide',
    );
  });

  it('flushes transaction reports in batches', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse({ processed: true }, 202));
    const connector = new PlatformConnector({
      apiKey: 'pk_test_123',
      baseUrl: 'https://platform.test',
      fetchFn,
      batchSize: 2,
      flushIntervalMs: 60_000,
    });

    connector.queueTransactionReport({
      id: 'txn_1',
      provider: 'stripe',
      providerId: 'prov_1',
      status: 'completed',
      amount: 1000,
      currency: 'USD',
      timestamp: '2026-03-02T00:00:00.000Z',
    });
    connector.queueTransactionReport({
      id: 'txn_2',
      provider: 'stripe',
      providerId: 'prov_2',
      status: 'completed',
      amount: 1200,
      currency: 'USD',
      timestamp: '2026-03-02T00:00:00.000Z',
    });

    await connector.flush();
    connector.close();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'https://platform.test/v1/transactions/report',
    );
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.transactions).toHaveLength(2);
  });

  it('flushes webhook events in batches', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(createJsonResponse({ received: 2 }, 202));
    const connector = new PlatformConnector({
      apiKey: 'pk_test_123',
      baseUrl: 'https://platform.test',
      fetchFn,
      batchSize: 2,
      flushIntervalMs: 60_000,
    });

    connector.queueWebhookEvent({
      id: 'evt_1',
      type: 'payment.completed',
      provider: 'stripe',
      providerEventId: 'pevt_1',
      data: {},
      timestamp: '2026-03-02T00:00:00.000Z',
    });
    connector.queueWebhookEvent({
      id: 'evt_2',
      type: 'payment.failed',
      provider: 'stripe',
      providerEventId: 'pevt_2',
      data: {},
      timestamp: '2026-03-02T00:00:00.000Z',
    });

    await connector.flush();
    connector.close();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(
      'https://platform.test/v1/events/webhook',
    );
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.events).toHaveLength(2);
  });

  it('retries transient failures with backoff', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(createJsonResponse({ processed: true }, 202));
    const connector = new PlatformConnector({
      apiKey: 'pk_test_123',
      baseUrl: 'https://platform.test',
      fetchFn,
      batchSize: 1,
      maxRetries: 1,
      initialBackoffMs: 1,
      flushIntervalMs: 60_000,
    });

    connector.queueTransactionReport({
      id: 'txn_1',
      provider: 'stripe',
      providerId: 'prov_1',
      status: 'completed',
      amount: 1000,
      currency: 'USD',
      timestamp: '2026-03-02T00:00:00.000Z',
    });

    await connector.flush();
    connector.close();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
