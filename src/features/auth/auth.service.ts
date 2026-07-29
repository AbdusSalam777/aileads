import bcrypt from 'bcryptjs';
import { ApiError } from '../../shared/api-error.js';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from './auth.tokens.js';
import { UserModel, type UserDocument } from './user.model.js';
import type { ChangePasswordInput, LoginInput, RegisterInput } from './auth.schemas.js';

const saltRounds = 12;

const sanitizeUser = (user: UserDocument) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const MAX_SESSIONS = 5;

/**
 * Written with an atomic update rather than load-modify-save. `sessions` (and
 * `sessions.refreshTokenHash`) are `select: false`, and Mongoose will not
 * persist changes to unselected paths — a save() here silently did nothing,
 * which meant rotated refresh tokens stayed valid forever. Atomic operators
 * also make concurrent refreshes safe.
 */
const createSession = async (
  user: UserDocument,
  refreshToken: string,
  rememberMe: boolean,
  meta: { userAgent?: string; ipAddress?: string },
) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000);

  // Drop anything already expired before appending, so the cap is not wasted.
  await UserModel.updateOne(
    { _id: user._id },
    { $pull: { sessions: { expiresAt: { $lte: now } } } },
  );

  await UserModel.updateOne(
    { _id: user._id },
    {
      $push: {
        sessions: {
          $each: [
            {
              refreshTokenHash: hashToken(refreshToken),
              userAgent: meta.userAgent,
              ipAddress: meta.ipAddress,
              expiresAt,
              createdAt: now,
            },
          ],
          $slice: -MAX_SESSIONS,
        },
      },
      $set: { lastLoginAt: now },
    },
  );
};

/**
 * Consumes a refresh token exactly once. Returns false when the token was
 * already used, expired or never existed — the single-document update is
 * atomic, so two concurrent refreshes can never both succeed.
 */
const consumeSession = async (userId: unknown, refreshToken: string) => {
  const tokenHash = hashToken(refreshToken);

  // The session must be matched by the QUERY, not judged from modifiedCount:
  // `timestamps: true` adds an `updatedAt` $set to every update, so a $pull that
  // removes nothing still reports modifiedCount = 1.
  const result = await UserModel.updateOne(
    {
      _id: userId,
      sessions: { $elemMatch: { refreshTokenHash: tokenHash, expiresAt: { $gt: new Date() } } },
    },
    { $pull: { sessions: { refreshTokenHash: tokenHash } } },
  );

  return result.matchedCount > 0;
};

const issueTokens = async (
  user: UserDocument,
  rememberMe: boolean,
  meta: { userAgent?: string; ipAddress?: string },
) => {
  const tokenUser = { id: user.id, email: user.email, role: user.role };
  const accessToken = signAccessToken(tokenUser);
  const refreshToken = signRefreshToken(tokenUser, rememberMe);

  await createSession(user, refreshToken, rememberMe, meta);

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(user),
  };
};

export const authService = {
  async register(input: RegisterInput, meta: { userAgent?: string; ipAddress?: string }) {
    const existingUser = await UserModel.exists({ email: input.email, deletedAt: null });

    if (existingUser) {
      throw new ApiError(409, 'Email is already registered', 'EMAIL_IN_USE');
    }

    const passwordHash = await bcrypt.hash(input.password, saltRounds);
    const user = await UserModel.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'user',
    });

    return issueTokens(user, Boolean(input.rememberMe), meta);
  },

  async login(input: LoginInput, meta: { userAgent?: string; ipAddress?: string }) {
    // createSession rewrites the whole sessions array, so the hashes must be
    // loaded too — otherwise retained sessions are written back without them.
    const user = await UserModel.findOne({ email: input.email, deletedAt: null }).select(
      '+passwordHash +sessions +sessions.refreshTokenHash +passwordChangedAt',
    );

    if (!user || user.status !== 'active' || !(await user.comparePassword(input.password))) {
      throw new ApiError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    return issueTokens(user, Boolean(input.rememberMe), meta);
  },

  async refresh(refreshToken: string, meta: { userAgent?: string; ipAddress?: string }) {
    const payload = verifyRefreshToken(refreshToken);
    const user = await UserModel.findOne({ _id: payload.sub, deletedAt: null }).select(
      '+passwordChangedAt',
    );

    if (!user || user.status !== 'active') {
      throw new ApiError(401, 'Invalid refresh token', 'INVALID_REFRESH_TOKEN');
    }

    // Atomically consume the presented token. Rotation is only real if the old
    // token stops working, so this must happen before new tokens are issued.
    if (!(await consumeSession(user._id, refreshToken))) {
      throw new ApiError(401, 'Refresh session expired', 'SESSION_EXPIRED');
    }

    return issueTokens(user, Boolean(payload.rememberMe), meta);
  },

  async logout(userId: string | undefined, refreshToken?: string) {
    if (!refreshToken) {
      return;
    }

    const tokenHash = hashToken(refreshToken);
    const filter = userId ? { _id: userId } : { 'sessions.refreshTokenHash': tokenHash };

    await UserModel.updateOne(filter, {
      $pull: { sessions: { refreshTokenHash: tokenHash } },
    });
  },

  async getProfile(userId: string) {
    const user = await UserModel.findOne({ _id: userId, deletedAt: null });

    if (!user) {
      throw new ApiError(404, 'User not found', 'USER_NOT_FOUND');
    }

    return sanitizeUser(user);
  },

  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await UserModel.findOne({ _id: userId, deletedAt: null }).select(
      '+passwordHash +sessions',
    );

    if (!user || !(await user.comparePassword(input.currentPassword))) {
      throw new ApiError(401, 'Current password is incorrect', 'INVALID_PASSWORD');
    }

    user.passwordHash = await bcrypt.hash(input.newPassword, saltRounds);
    user.passwordChangedAt = new Date();
    user.sessions = [];
    await user.save();

    return sanitizeUser(user);
  },
};
