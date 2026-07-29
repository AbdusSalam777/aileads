import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

export type UnsubscribePayload = {
  email: string;
  leadId: string;
};

const base64url = (input: Buffer | string) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64url = (input: string) =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sign = (body: string, secret: string) =>
  base64url(createHmac('sha256', secret).update(body).digest());

/**
 * Self-contained signed token so the unsubscribe endpoint needs no session and
 * no database lookup to prove the link is genuine.
 */
export const createUnsubscribeToken = (
  payload: UnsubscribePayload,
  secret: string = env.UNSUBSCRIBE_SECRET,
): string => {
  const body = base64url(JSON.stringify({ e: payload.email.toLowerCase(), l: payload.leadId }));
  return `${body}.${sign(body, secret)}`;
};

export const verifyUnsubscribeToken = (
  token: string,
  secret: string = env.UNSUBSCRIBE_SECRET,
): UnsubscribePayload | undefined => {
  const parts = token.split('.');

  if (parts.length !== 2) {
    return undefined;
  }

  const [body, signature] = parts;

  if (!body || !signature) {
    return undefined;
  }

  const expected = sign(body, secret);
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  // Length check first: timingSafeEqual throws on mismatched lengths.
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fromBase64url(body).toString('utf8')) as { e?: string; l?: string };

    if (!parsed.e || !parsed.l) {
      return undefined;
    }

    return { email: parsed.e, leadId: parsed.l };
  } catch {
    return undefined;
  }
};
