export interface SignedWebhookPayload {
  payload: string;
  headers: Record<string, string>;
}

export function createSignedWebhookPayload(
  payload: unknown,
  secret: string,
): SignedWebhookPayload {
  const serialized = JSON.stringify(payload);
  const signature = `${secret.length}.${serialized.length}`;

  return {
    payload: serialized,
    headers: {
      'x-vault-test-signature': signature,
    },
  };
}
