import { createHmac, timingSafeEqual } from 'node:crypto';

export function toRawString(payload: Buffer | string): string {
  return typeof payload === 'string' ? payload : payload.toString('utf-8');
}

export function createHmacDigest(
  algorithm: 'sha256' | 'sha512',
  secret: string,
  content: string,
): string {
  return createHmac(algorithm, secret).update(content).digest('hex');
}

export function secureCompareHex(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');

  if (left.length !== right.length || left.length === 0) {
    return false;
  }

  return timingSafeEqual(left, right);
}
