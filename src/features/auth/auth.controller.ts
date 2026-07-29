import type { RequestHandler } from 'express';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/api-response.js';
import { getRefreshTokenFromCookies, setRefreshTokenCookie, clearRefreshTokenCookie } from './auth.cookies.js';
import { authService } from './auth.service.js';

const getRequestMeta = (req: Parameters<RequestHandler>[0]) => ({
  userAgent: req.get('user-agent'),
  ipAddress: req.ip,
});

export const authController = {
  register: (async (req, res) => {
    const result = await authService.register(req.body, getRequestMeta(req));
    setRefreshTokenCookie(res, result.refreshToken, Boolean(req.body.rememberMe));
    sendSuccess(res, {
      statusCode: 201,
      message: 'Registration successful',
      data: { accessToken: result.accessToken, user: result.user },
    });
  }) satisfies RequestHandler,

  login: (async (req, res) => {
    const result = await authService.login(req.body, getRequestMeta(req));
    setRefreshTokenCookie(res, result.refreshToken, Boolean(req.body.rememberMe));
    sendSuccess(res, {
      message: 'Login successful',
      data: { accessToken: result.accessToken, user: result.user },
    });
  }) satisfies RequestHandler,

  refresh: (async (req, res) => {
    const refreshToken = getRefreshTokenFromCookies(req.cookies);

    if (!refreshToken) {
      throw new ApiError(401, 'Refresh token is required', 'REFRESH_TOKEN_REQUIRED');
    }

    const result = await authService.refresh(refreshToken, getRequestMeta(req));
    setRefreshTokenCookie(res, result.refreshToken);
    sendSuccess(res, {
      message: 'Token refreshed',
      data: { accessToken: result.accessToken, user: result.user },
    });
  }) satisfies RequestHandler,

  logout: (async (req, res) => {
    await authService.logout(req.user?.id, getRefreshTokenFromCookies(req.cookies));
    clearRefreshTokenCookie(res);
    sendSuccess(res, { message: 'Logout successful', data: null });
  }) satisfies RequestHandler,

  profile: (async (req, res) => {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    }

    const user = await authService.getProfile(req.user.id);
    sendSuccess(res, { data: user });
  }) satisfies RequestHandler,

  changePassword: (async (req, res) => {
    if (!req.user) {
      throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    }

    const user = await authService.changePassword(req.user.id, req.body);
    clearRefreshTokenCookie(res);
    sendSuccess(res, { message: 'Password changed successfully', data: user });
  }) satisfies RequestHandler,
};
