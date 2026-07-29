import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { UserRole } from './user.model.js';

export type TokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
};

type TokenSubject = {
  id: string;
  email: string;
  role: UserRole;
};

export const signAccessToken = (user: TokenSubject) =>
  jwt.sign({ email: user.email, role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as SignOptions);

/**
 * `jti` makes every refresh token unique. Without it the claims are identical
 * between issues and `iat` only has one-second resolution, so a refresh in the
 * same second as the previous issue produced a byte-identical token — which
 * silently turned rotation into a no-op and left used tokens replayable.
 */
export const signRefreshToken = (user: TokenSubject, rememberMe = false) =>
  jwt.sign(
    { email: user.email, role: user.role, rememberMe, jti: crypto.randomUUID() },
    env.JWT_REFRESH_SECRET,
    {
      subject: user.id,
      expiresIn: rememberMe ? '30d' : env.JWT_REFRESH_EXPIRES_IN,
    } as SignOptions,
  );

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as TokenPayload;

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload & { rememberMe?: boolean };

export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
