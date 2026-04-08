import type {
  CredentialRecord,
  IdentityRecord,
  OAuthStateRecord,
  SessionRecord,
  UserRecord,
  VerificationTokenRecord,
} from '../types/entities.js';

/**
 * 密码登录支持的账号标识类型。
 */
export type PasswordLoginIdentifierType = 'username' | 'email' | 'phone';

/**
 * 密码登录查找身份时的输入参数。
 */
export interface FindPasswordIdentityInput {
  identifierType: PasswordLoginIdentifierType;
  identifierValue: string;
}

/**
 * 创建用户时所需的数据。
 */
export interface CreateUserInput {
  displayName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  status: 'active' | 'disabled' | 'pending';
}

/**
 * 创建身份时所需的数据。
 */
export interface CreateIdentityInput {
  userId: string;
  providerType: string;
  providerSubject: string;
  username?: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatarUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 创建验证码记录时所需的数据。
 */
export interface CreateVerificationTokenInput {
  scene: 'login' | 'bind' | 'reset_password';
  channel: 'email' | 'sms' | 'magic_link';
  userId?: string;
  target: string;
  tokenHash: string;
  codeLength?: number;
  maxAttempts: number;
  expiresAt: Date;
  senderName?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 创建 OAuth state 时所需的数据。
 */
export interface CreateOAuthStateInput {
  providerType: string;
  stateHash: string;
  redirectTo?: string;
  pkceVerifier?: string;
  expiresAt: Date;
}

/**
 * 创建刷新会话时所需的数据。
 */
export interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  deviceInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
}

/**
 * 用户仓储接口。
 */
export interface UserRepository {
  findById(userId: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByPhone(phone: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  updateLastLoginAt(userId: string, lastLoginAt: Date): Promise<void>;
}

/**
 * 身份仓储接口。
 */
export interface IdentityRepository {
  findByProvider(providerType: string, providerSubject: string): Promise<IdentityRecord | null>;
  findPasswordIdentityByIdentifier(input: FindPasswordIdentityInput): Promise<IdentityRecord | null>;
  create(input: CreateIdentityInput): Promise<IdentityRecord>;
  listByUserId(userId: string): Promise<IdentityRecord[]>;
}

/**
 * 凭证仓储接口。
 */
export interface CredentialRepository {
  findByIdentityId(identityId: string): Promise<CredentialRecord | null>;
  upsertPasswordHash(identityId: string, passwordHash: string, passwordAlgo: string): Promise<void>;
}

/**
 * 验证码仓储接口。
 */
export interface VerificationTokenRepository {
  create(input: CreateVerificationTokenInput): Promise<VerificationTokenRecord>;
  findActiveByTarget(
    target: string,
    scene: 'login' | 'bind' | 'reset_password',
    channel: 'email' | 'sms' | 'magic_link',
  ): Promise<VerificationTokenRecord | null>;
  incrementAttemptCount(tokenId: string): Promise<void>;
  consume(tokenId: string, consumedAt: Date): Promise<void>;
}

/**
 * OAuth state 仓储接口。
 */
export interface OAuthStateRepository {
  create(input: CreateOAuthStateInput): Promise<OAuthStateRecord>;
  consumeByStateHash(stateHash: string, consumedAt: Date): Promise<OAuthStateRecord | null>;
}

/**
 * 会话仓储接口。
 */
export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findByRefreshTokenHash(refreshTokenHash: string): Promise<SessionRecord | null>;
  revoke(sessionId: string, revokedAt: Date): Promise<void>;
}

/**
 * 存储层统一适配接口。
 */
export interface StorageAdapter {
  users: UserRepository;
  identities: IdentityRepository;
  credentials: CredentialRepository;
  verificationTokens: VerificationTokenRepository;
  oauthStates: OAuthStateRepository;
  sessions: SessionRepository;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  transaction<T>(handler: (storage: StorageAdapter) => Promise<T>): Promise<T>;
}
