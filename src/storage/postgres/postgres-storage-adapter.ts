import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type {
  CredentialRepository,
  IdentityRepository,
  OAuthStateRepository,
  SessionRepository,
  StorageAdapter,
  UserRepository,
  VerificationTokenRepository,
} from '../storage-adapter.js';

/**
 * PostgreSQL 存储适配器的占位实现。
 */
export class PostgresStorageAdapter implements StorageAdapter {
  users: UserRepository;
  identities: IdentityRepository;
  credentials: CredentialRepository;
  verificationTokens: VerificationTokenRepository;
  oauthStates: OAuthStateRepository;
  sessions: SessionRepository;
  private readonly connectionString: string;

  /**
   * 创建 PostgreSQL 存储适配器。
   */
  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.users = this.createNotImplementedRepository<UserRepository>('users');
    this.identities = this.createNotImplementedRepository<IdentityRepository>('identities');
    this.credentials = this.createNotImplementedRepository<CredentialRepository>('credentials');
    this.verificationTokens = this.createNotImplementedRepository<VerificationTokenRepository>('verificationTokens');
    this.oauthStates = this.createNotImplementedRepository<OAuthStateRepository>('oauthStates');
    this.sessions = this.createNotImplementedRepository<SessionRepository>('sessions');
  }

  /**
   * 建立数据库连接。
   */
  async connect(): Promise<void> {
    if (!this.connectionString) {
      throw new OmniAuthError({
        code: ERROR_CODES.CFG_DATABASE_001,
        message: 'PostgreSQL 连接串不能为空',
      });
    }
  }

  /**
   * 关闭数据库连接。
   */
  async disconnect(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * 执行事务。
   */
  async transaction<T>(handler: (storage: StorageAdapter) => Promise<T>): Promise<T> {
    try {
      return await handler(this);
    } catch (error) {
      throw new OmniAuthError({
        code: ERROR_CODES.DB_TX_001,
        message: '数据库事务执行失败',
        cause: error,
      });
    }
  }

  /**
   * 创建一个“尚未实现”的仓储占位对象。
   */
  private createNotImplementedRepository<T>(repositoryName: string): T {
    return new Proxy(
      {},
      {
        get: (_target, property) => {
          return async () => {
            throw new OmniAuthError({
              code: ERROR_CODES.DB_QUERY_001,
              message: `仓储 ${repositoryName}.${String(property)} 尚未实现`,
            });
          };
        },
      },
    ) as T;
  }
}
