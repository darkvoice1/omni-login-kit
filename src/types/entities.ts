/**
 * 系统中的统一用户实体。
 */
export interface UserRecord {
  id: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
  phone?: string;
  status: 'active' | 'disabled' | 'pending';
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 登录身份实体。
 */
export interface IdentityRecord {
  id: string;
  userId: string;
  providerType: string;
  providerSubject: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatarUrl?: string;
  metadata: Record<string, unknown>;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 本地凭证实体。
 */
export interface CredentialRecord {
  id: string;
  identityId: string;
  passwordHash: string;
  passwordAlgo: string;
  passwordUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 验证码或魔法链接实体。
 */
export interface VerificationTokenRecord {
  id: string;
  scene: 'login' | 'bind' | 'reset_password';
  channel: 'email' | 'sms' | 'magic_link';
  userId?: string;
  target: string;
  tokenHash: string;
  codeLength?: number;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt?: Date;
  senderName?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * OAuth state 实体。
 */
export interface OAuthStateRecord {
  id: string;
  providerType: string;
  stateHash: string;
  redirectTo?: string;
  pkceVerifier?: string;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
}

/**
 * 刷新会话实体。
 */
export interface SessionRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceInfo?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastSeenAt?: Date;
  createdAt: Date;
}

/**
 * 审计日志实体。
 */
export interface AuditLogRecord {
  id: string;
  userId?: string;
  eventType: string;
  providerType?: string;
  target?: string;
  ipAddress?: string;
  userAgent?: string;
  result: 'success' | 'failed';
  errorCode?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}
