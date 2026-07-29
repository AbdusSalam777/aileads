import type { Response } from 'express';
import { env } from '../../config/env.js';

const refreshCookieName = 'refreshToken';
const refreshCookiePath = `${env.API_PREFIX}/auth`;

export const setRefreshTokenCookie = (res: Response, token: string, rememberMe = false) => {
  res.cookie(refreshCookieName, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: env.AUTH_COOKIE_DOMAIN || undefined,
    path: refreshCookiePath,
    maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000,
  });
};

export const clearRefreshTokenCookie = (res: Response) => {
  res.clearCookie(refreshCookieName, {
    domain: env.AUTH_COOKIE_DOMAIN || undefined,
    path: refreshCookiePath,
  });
};

export const getRefreshTokenFromCookies = (cookies: Record<string, string | undefined>) =>
  cookies[refreshCookieName];
