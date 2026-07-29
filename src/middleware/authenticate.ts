import type { RequestHandler } from 'express';
import { ApiError } from '../shared/api-error.js';
import { verifyAccessToken } from '../features/auth/auth.tokens.js';
import { UserModel } from '../features/auth/user.model.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      throw new ApiError(401, 'Authentication required', 'AUTH_REQUIRED');
    }

    const payload = verifyAccessToken(token);
    const user = await UserModel.findOne({ _id: payload.sub, deletedAt: null }).select(
      '+passwordChangedAt',
    );

    if (!user || user.status !== 'active') {
      throw new ApiError(401, 'Invalid authentication token', 'INVALID_TOKEN');
    }

    if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw new ApiError(401, 'Password changed recently. Please sign in again.', 'TOKEN_STALE');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    next(error);
  }
};
