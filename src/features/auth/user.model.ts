import bcrypt from 'bcryptjs';
import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';

export const userRoles = ['admin', 'user'] as const;
export type UserRole = (typeof userRoles)[number];

export const userStatuses = ['active', 'inactive', 'suspended'] as const;
export type UserStatus = (typeof userStatuses)[number];

export type SessionInfo = {
  refreshTokenHash: string;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
  createdAt: Date;
};

export type User = {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  sessions: SessionInfo[];
  lastLoginAt?: Date;
  passwordChangedAt?: Date;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserMethods = {
  comparePassword(password: string): Promise<boolean>;
};

type UserModelType = Model<User, object, UserMethods>;

export type UserDocument = HydratedDocument<User, UserMethods>;

const sessionSchema = new Schema<SessionInfo>(
  {
    refreshTokenHash: { type: String, required: true, select: false },
    userAgent: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    expiresAt: { type: Date, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new Schema<User, UserModelType, UserMethods>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: userRoles, default: 'user', index: true },
    status: { type: String, enum: userStatuses, default: 'active', index: true },
    sessions: { type: [sessionSchema], default: [], select: false },
    lastLoginAt: Date,
    passwordChangedAt: { type: Date, select: false },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

userSchema.index({ email: 1, deletedAt: 1 });

userSchema.methods.comparePassword = function comparePassword(password: string) {
  return bcrypt.compare(password, this.passwordHash);
};

export const UserModel =
  mongoose.models.User ?? mongoose.model<User, UserModelType>('User', userSchema);
