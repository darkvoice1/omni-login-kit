import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type {
  CreateIdentityInput,
  CreateOAuthStateInput,
  CreateSessionInput,
  CreateUserInput,
  CreateVerificationTokenInput,
  CredentialRepository,
  FindPasswordIdentityInput,
  IdentityRepository,
  OAuthStateRepository,
  SessionRepository,
  StorageAdapter,
  UserRepository,
  VerificationTokenRepository,
} from '../storage-adapter.js';
import type {
  CredentialRecord,
  IdentityRecord,
  OAuthStateRecord,
  SessionRecord,
  UserRecord,
  VerificationTokenRecord,
} from '../../types/entities.js';

/**
 * users 表查询结果。
 */
interface UserRow extends QueryResultRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  status: 'active' | 'disabled' | 'pending';
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * identities 表查询结果。
 */
interface IdentityRow extends QueryResultRow {
  id: string;
  user_id: string;
  provider_type: string;
  provider_subject: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  nickname: string | null;
  avatar_url: string | null;
  metadata: Record<string, unknown>;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * credentials 表查询结果。
 */
interface CredentialRow extends QueryResultRow {
  id: string;
  identity_id: string;
  password_hash: string;
  password_algo: string;
  password_updated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * verification_tokens 表查询结果。
 */
interface VerificationTokenRow extends QueryResultRow {
  id: string;
  scene: 'login' | 'bind' | 'reset_password';
  channel: 'email' | 'sms' | 'magic_link';
  user_id: string | null;
  target: string;
  token_hash: string;
  code_length: number | null;
  attempt_count: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  sender_name: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}
/**
 * oauth_states 表查询结果。
 */
interface OAuthStateRow extends QueryResultRow {
  id: string;
  provider_type: string;
  state_hash: string;
  redirect_to: string | null;
  pkce_verifier: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

/**
 * sessions 表查询结果。
 */
interface SessionRow extends QueryResultRow {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  device_info: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_seen_at: Date | null;
  created_at: Date;
}

export interface PostgresStorageAdapterOptions {
  autoMigrate?: boolean;
  migrationsDir?: string;
}

interface SqlMigration {
  id: string;
  sql: string;
}

/**
 * PostgreSQL 存储适配器。
 */
export class PostgresStorageAdapter implements StorageAdapter {
  users: UserRepository;
  identities: IdentityRepository;
  credentials: CredentialRepository;
  verificationTokens: VerificationTokenRepository;
  oauthStates: OAuthStateRepository;
  sessions: SessionRepository;
  private readonly connectionString: string;
  private readonly autoMigrate: boolean;
  private readonly migrationsDir?: string;
  private pool?: Pool;

  /**
   * 创建 PostgreSQL 存储适配器。
   */
  constructor(connectionString: string, options: PostgresStorageAdapterOptions = {}) {
    this.connectionString = connectionString;
    this.autoMigrate = options.autoMigrate ?? true;
    this.migrationsDir = options.migrationsDir;
    this.users = this.createUserRepository();
    this.identities = this.createIdentityRepository();
    this.credentials = this.createCredentialRepository();
    this.verificationTokens = this.createVerificationTokenRepository();
    this.oauthStates = this.createOAuthStateRepository();
    this.sessions = this.createSessionRepository();
  }

  /**
   * 建立数据库连接池，并做一次最小连通性验证。
   */
  async connect(): Promise<void> {
    if (!this.connectionString) {
      throw new OmniAuthError({
        code: ERROR_CODES.CFG_DATABASE_001,
        message: 'PostgreSQL 连接串不能为空',
      });
    }

    if (this.pool) {
      return;
    }

    this.pool = new Pool({
      connectionString: this.connectionString,
    });

    try {
      await this.pool.query('SELECT 1');
    } catch (error) {
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: 'PostgreSQL 连接测试失败',
        cause: error,
      });
    }

    if (!this.autoMigrate) {
      return;
    }

    try {
      await this.runMigrations();
    } catch (error) {
      await this.pool.end();
      this.pool = undefined;
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: 'PostgreSQL 自动迁移执行失败',
        cause: error,
      });
    }
  }

  /**
   * 关闭数据库连接池。
   */
  async disconnect(): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.end();
    this.pool = undefined;
  }

  /**
   * 执行事务。
   */
  async transaction<T>(handler: (storage: StorageAdapter) => Promise<T>): Promise<T> {
    const client = await this.getClient();

    try {
      await client.query('BEGIN');
      const transactionalStorage = this.createTransactionalStorage(client);
      const result = await handler(transactionalStorage);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new OmniAuthError({
        code: ERROR_CODES.DB_TX_001,
        message: '数据库事务执行失败',
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  /**
   * 获取连接池实例。
   */
  protected getPool(): Pool {
    if (!this.pool) {
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: 'PostgreSQL 连接池尚未初始化，请先调用 connect()',
      });
    }

    return this.pool;
  }

  /**
   * 获取数据库客户端连接。
   */
  protected async getClient(): Promise<PoolClient> {
    try {
      return await this.getPool().connect();
    } catch (error) {
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: '获取 PostgreSQL 客户端连接失败',
        cause: error,
      });
    }
  }

  /**
   * 执行查询并返回结果。
   */
  protected async executeQuery<T extends QueryResultRow>(
    queryText: string,
    values: unknown[] = [],
    client?: PoolClient,
  ): Promise<T[]> {
    try {
      const executor = client ?? this.getPool();
      const result = await executor.query<T>(queryText, values);
      return result.rows;
    } catch (error) {
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: 'PostgreSQL 查询执行失败',
        cause: error,
      });
    }
  }

  /**
   * 创建用户仓储实现。
   */
  private createUserRepository(client?: PoolClient): UserRepository {
    return {
      findById: async (userId: string) => {
        const rows = await this.executeQuery<UserRow>(
          'SELECT * FROM users WHERE id = $1 LIMIT 1',
          [userId],
          client,
        );
        return rows[0] ? this.mapUserRow(rows[0]) : null;
      },
      findByEmail: async (email: string) => {
        const rows = await this.executeQuery<UserRow>(
          'SELECT * FROM users WHERE email = $1 LIMIT 1',
          [email],
          client,
        );
        return rows[0] ? this.mapUserRow(rows[0]) : null;
      },
      findByPhone: async (phone: string) => {
        const rows = await this.executeQuery<UserRow>(
          'SELECT * FROM users WHERE phone = $1 LIMIT 1',
          [phone],
          client,
        );
        return rows[0] ? this.mapUserRow(rows[0]) : null;
      },
      create: async (input: CreateUserInput) => {
        const rows = await this.executeQuery<UserRow>(
          `
          INSERT INTO users (display_name, avatar_url, email, phone, status)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
          `,
          [input.displayName, input.avatarUrl ?? null, input.email ?? null, input.phone ?? null, input.status],
          client,
        );
        return this.mapUserRow(rows[0]);
      },
      updateLastLoginAt: async (userId: string, lastLoginAt: Date) => {
        await this.executeQuery(
          'UPDATE users SET last_login_at = $2, updated_at = now() WHERE id = $1',
          [userId, lastLoginAt],
          client,
        );
      },
    };
  }

  /**
   * 创建身份仓储实现。
   */
  private createIdentityRepository(client?: PoolClient): IdentityRepository {
    return {
      findById: async (identityId: string) => {
        const rows = await this.executeQuery<IdentityRow>(
          'SELECT * FROM identities WHERE id = $1 LIMIT 1',
          [identityId],
          client,
        );
        return rows[0] ? this.mapIdentityRow(rows[0]) : null;
      },
      findByProvider: async (providerType: string, providerSubject: string) => {
        const rows = await this.executeQuery<IdentityRow>(
          'SELECT * FROM identities WHERE provider_type = $1 AND provider_subject = $2 LIMIT 1',
          [providerType, providerSubject],
          client,
        );
        return rows[0] ? this.mapIdentityRow(rows[0]) : null;
      },
      findPasswordIdentityByIdentifier: async (input: FindPasswordIdentityInput) => {
        const fieldName =
          input.identifierType === 'username'
            ? 'username'
            : input.identifierType === 'email'
              ? 'email'
              : 'phone';

        const rows = await this.executeQuery<IdentityRow>(
          `SELECT * FROM identities WHERE provider_type = 'password' AND ${fieldName} = $1 LIMIT 1`,
          [input.identifierValue],
          client,
        );
        return rows[0] ? this.mapIdentityRow(rows[0]) : null;
      },
      create: async (input: CreateIdentityInput) => {
        const rows = await this.executeQuery<IdentityRow>(
          `
          INSERT INTO identities (
            user_id,
            provider_type,
            provider_subject,
            username,
            email,
            phone,
            nickname,
            avatar_url,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
          `,
          [
            input.userId,
            input.providerType,
            input.providerSubject,
            input.username ?? null,
            input.email ?? null,
            input.phone ?? null,
            input.nickname ?? null,
            input.avatarUrl ?? null,
            input.metadata ?? {},
          ],
          client,
        );
        return this.mapIdentityRow(rows[0]);
      },
      listByUserId: async (userId: string) => {
        const rows = await this.executeQuery<IdentityRow>(
          'SELECT * FROM identities WHERE user_id = $1 ORDER BY created_at ASC',
          [userId],
          client,
        );
        return rows.map((row) => this.mapIdentityRow(row));
      },
      deleteById: async (identityId: string) => {
        await this.executeQuery('DELETE FROM identities WHERE id = $1', [identityId], client);
      },
    };
  }

  /**
   * 创建凭证仓储实现。
   */
  private createCredentialRepository(client?: PoolClient): CredentialRepository {
    return {
      findByIdentityId: async (identityId: string) => {
        const rows = await this.executeQuery<CredentialRow>(
          'SELECT * FROM credentials WHERE identity_id = $1 LIMIT 1',
          [identityId],
          client,
        );
        return rows[0] ? this.mapCredentialRow(rows[0]) : null;
      },
      upsertPasswordHash: async (identityId: string, passwordHash: string, passwordAlgo: string) => {
        await this.executeQuery(
          `
          INSERT INTO credentials (identity_id, password_hash, password_algo, password_updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (identity_id)
          DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            password_algo = EXCLUDED.password_algo,
            password_updated_at = now(),
            updated_at = now()
          `,
          [identityId, passwordHash, passwordAlgo],
          client,
        );
      },
    };
  }

  /**
   * 创建验证码仓储实现。
   */
  private createVerificationTokenRepository(client?: PoolClient): VerificationTokenRepository {
    return {
      create: async (input: CreateVerificationTokenInput) => {
        const rows = await this.executeQuery<VerificationTokenRow>(
          `
          INSERT INTO verification_tokens (
            scene,
            channel,
            user_id,
            target,
            token_hash,
            code_length,
            max_attempts,
            expires_at,
            sender_name,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
          `,
          [
            input.scene,
            input.channel,
            input.userId ?? null,
            input.target,
            input.tokenHash,
            input.codeLength ?? null,
            input.maxAttempts,
            input.expiresAt,
            input.senderName ?? null,
            input.metadata ?? {},
          ],
          client,
        );
        return this.mapVerificationTokenRow(rows[0]);
      },
      findActiveByTarget: async (target, scene, channel) => {
        const rows = await this.executeQuery<VerificationTokenRow>(
          `
          SELECT *
          FROM verification_tokens
          WHERE target = $1
            AND scene = $2
            AND channel = $3
            AND consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [target, scene, channel],
          client,
        );
        return rows[0] ? this.mapVerificationTokenRow(rows[0]) : null;
      },
      incrementAttemptCount: async (tokenId: string) => {
        await this.executeQuery(
          'UPDATE verification_tokens SET attempt_count = attempt_count + 1 WHERE id = $1',
          [tokenId],
          client,
        );
      },
      consume: async (tokenId: string, consumedAt: Date) => {
        await this.executeQuery(
          'UPDATE verification_tokens SET consumed_at = $2 WHERE id = $1',
          [tokenId, consumedAt],
          client,
        );
      },
    };
  }

  /**
   * 创建 OAuth state 仓储实现。
   */
  private createOAuthStateRepository(client?: PoolClient): OAuthStateRepository {
    return {
      create: async (input: CreateOAuthStateInput) => {
        const rows = await this.executeQuery<OAuthStateRow>(
          `
          INSERT INTO oauth_states (
            provider_type,
            state_hash,
            redirect_to,
            pkce_verifier,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
          `,
          [
            input.providerType,
            input.stateHash,
            input.redirectTo ?? null,
            input.pkceVerifier ?? null,
            input.expiresAt,
          ],
          client,
        );
        return this.mapOAuthStateRow(rows[0]);
      },
      consumeByStateHash: async (stateHash: string, consumedAt: Date) => {
        // 只消费一次、且必须在未过期窗口内消费，避免重复回调和过期 state 被利用。
        const rows = await this.executeQuery<OAuthStateRow>(
          `
          WITH candidate AS (
            SELECT id
            FROM oauth_states
            WHERE state_hash = $1
              AND consumed_at IS NULL
              AND expires_at >= $2
            ORDER BY created_at DESC
            LIMIT 1
          )
          UPDATE oauth_states
          SET consumed_at = $2
          WHERE id IN (SELECT id FROM candidate)
          RETURNING *
          `,
          [stateHash, consumedAt],
          client,
        );

        return rows[0] ? this.mapOAuthStateRow(rows[0]) : null;
      },
    };
  }

  /**
   * 创建会话仓储实现。
   */
  private createSessionRepository(client?: PoolClient): SessionRepository {
    return {
      create: async (input: CreateSessionInput) => {
        const rows = await this.executeQuery<SessionRow>(
          `
          INSERT INTO sessions (
            user_id,
            refresh_token_hash,
            device_info,
            ip_address,
            user_agent,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
          `,
          [
            input.userId,
            input.refreshTokenHash,
            input.deviceInfo ?? null,
            input.ipAddress ?? null,
            input.userAgent ?? null,
            input.expiresAt,
          ],
          client,
        );
        return this.mapSessionRow(rows[0]);
      },
      findByRefreshTokenHash: async (refreshTokenHash: string) => {
        const rows = await this.executeQuery<SessionRow>(
          'SELECT * FROM sessions WHERE refresh_token_hash = $1 LIMIT 1',
          [refreshTokenHash],
          client,
        );
        return rows[0] ? this.mapSessionRow(rows[0]) : null;
      },
      revoke: async (sessionId: string, revokedAt: Date) => {
        await this.executeQuery(
          'UPDATE sessions SET revoked_at = $2 WHERE id = $1',
          [sessionId, revokedAt],
          client,
        );
      },
    };
  }

  /**
   * 创建一个绑定事务客户端的临时存储适配器。
   */
  private createTransactionalStorage(client: PoolClient): StorageAdapter {
    return {
      users: this.createUserRepository(client),
      identities: this.createIdentityRepository(client),
      credentials: this.createCredentialRepository(client),
      verificationTokens: this.createVerificationTokenRepository(client),
      oauthStates: this.createOAuthStateRepository(client),
      sessions: this.createSessionRepository(client),
      connect: async () => undefined,
      disconnect: async () => undefined,
      transaction: async <T>(_handler: (storage: StorageAdapter) => Promise<T>) => {
        throw new OmniAuthError({
          code: ERROR_CODES.DB_TX_001,
          message: '当前暂不支持事务内部再次开启嵌套事务',
        });
      },
    };
  }

  private async runMigrations(): Promise<void> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [2331, 1001]);

      await client.query(`
        CREATE TABLE IF NOT EXISTS omni_auth_schema_migrations (
          id varchar(255) PRIMARY KEY,
          executed_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const migrations = await this.loadMigrations();
      for (const migration of migrations) {
        const checkResult = await client.query<{ id: string }>(
          'SELECT id FROM omni_auth_schema_migrations WHERE id = $1 LIMIT 1',
          [migration.id],
        );

        if (checkResult.rowCount && checkResult.rowCount > 0) {
          continue;
        }

        await client.query(migration.sql);
        await client.query('INSERT INTO omni_auth_schema_migrations (id) VALUES ($1)', [migration.id]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: '执行数据库 migration 失败',
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  private async loadMigrations(): Promise<SqlMigration[]> {
    const migrationsDir = this.resolveMigrationsDir();
    let filenames: string[];

    try {
      filenames = (await readdir(migrationsDir))
        .filter((name) => name.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: `读取 migration 目录失败：${migrationsDir}`,
        cause: error,
      });
    }

    if (filenames.length === 0) {
      throw new OmniAuthError({
        code: ERROR_CODES.DB_QUERY_001,
        message: `migration 目录为空：${migrationsDir}`,
      });
    }

    const migrations: SqlMigration[] = [];
    for (const filename of filenames) {
      const filePath = path.join(migrationsDir, filename);
      let sqlText: string;
      try {
        sqlText = await readFile(filePath, 'utf8');
      } catch (error) {
        throw new OmniAuthError({
          code: ERROR_CODES.DB_QUERY_001,
          message: `读取 migration 文件失败：${filePath}`,
          cause: error,
        });
      }

      const normalizedSql = sqlText.replace(/^\uFEFF/, '').trim();
      if (!normalizedSql) {
        continue;
      }

      migrations.push({
        id: filename,
        sql: normalizedSql,
      });
    }

    return migrations;
  }

  private resolveMigrationsDir(): string {
    if (this.migrationsDir) {
      return path.resolve(this.migrationsDir);
    }

    const packageRootDir = path.resolve(__dirname, '../../../');
    return path.join(packageRootDir, 'migrations');
  }

  /**
   * 把 users 表行数据转换成代码里的 UserRecord。
   */
  private mapUserRow(row: UserRow): UserRecord {
    return {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      status: row.status,
      lastLoginAt: row.last_login_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 把 identities 表行数据转换成代码里的 IdentityRecord。
   */
  private mapIdentityRow(row: IdentityRow): IdentityRecord {
    return {
      id: row.id,
      userId: row.user_id,
      providerType: row.provider_type,
      providerSubject: row.provider_subject,
      username: row.username ?? undefined,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      nickname: row.nickname ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      metadata: row.metadata ?? {},
      lastUsedAt: row.last_used_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 把 credentials 表行数据转换成代码里的 CredentialRecord。
   */
  private mapCredentialRow(row: CredentialRow): CredentialRecord {
    return {
      id: row.id,
      identityId: row.identity_id,
      passwordHash: row.password_hash,
      passwordAlgo: row.password_algo,
      passwordUpdatedAt: row.password_updated_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 把 verification_tokens 表行数据转换成代码里的 VerificationTokenRecord。
   */
  private mapVerificationTokenRow(row: VerificationTokenRow): VerificationTokenRecord {
    return {
      id: row.id,
      scene: row.scene,
      channel: row.channel,
      userId: row.user_id ?? undefined,
      target: row.target,
      tokenHash: row.token_hash,
      codeLength: row.code_length ?? undefined,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at ?? undefined,
      senderName: row.sender_name ?? undefined,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    };
  }

  /**
   * 把 oauth_states 表行数据转换成代码里的 OAuthStateRecord。
   */
  private mapOAuthStateRow(row: OAuthStateRow): OAuthStateRecord {
    return {
      id: row.id,
      providerType: row.provider_type,
      stateHash: row.state_hash,
      redirectTo: row.redirect_to ?? undefined,
      pkceVerifier: row.pkce_verifier ?? undefined,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at ?? undefined,
      createdAt: row.created_at,
    };
  }
  /**
   * 把 sessions 表行数据转换成代码里的 SessionRecord。
   */
  private mapSessionRow(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      userId: row.user_id,
      refreshTokenHash: row.refresh_token_hash,
      deviceInfo: row.device_info ?? undefined,
      ipAddress: row.ip_address ?? undefined,
      userAgent: row.user_agent ?? undefined,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at ?? undefined,
      lastSeenAt: row.last_seen_at ?? undefined,
      createdAt: row.created_at,
    };
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


