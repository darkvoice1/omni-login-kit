import { createHash, randomUUID } from 'node:crypto';
import { ERROR_CODES } from '../../errors/error-codes.js';
import { OmniAuthError } from '../../errors/omni-auth-error.js';
import type { BaseOAuthProviderConfig, ProviderType } from '../../types/auth-config.js';
import type { OAuthStateRecord } from '../../types/entities.js';
import type { OAuthProvider, ProviderAuthResult, ProviderContext } from './types.js';

/**
 * OAuth Provider 的基础实现。
 */
export abstract class BaseOAuthProvider implements OAuthProvider {
  name: string;
  type: ProviderType;
  enabled: boolean;
  protected config: BaseOAuthProviderConfig;
  protected context?: ProviderContext;

  /**
   * 创建基础 OAuth Provider。
   */
  constructor(name: string, type: ProviderType, config: BaseOAuthProviderConfig) {
    this.name = name;
    this.type = type;
    this.enabled = config.enabled;
    this.config = config;
  }

  /**
   * 缓存上下文，供后续授权和回调流程复用。
   */
  async initialize(context: ProviderContext): Promise<void> {
    this.context = context;
  }

  /**
   * 生成授权地址，并把 state 存入存储层。
   */
  async createAuthorizationUrl(input?: Record<string, unknown>): Promise<string> {
    const context = this.ensureContext();

    // 先生成原始 state，并对存库值做哈希处理。
    const rawState = randomUUID();
    const stateHash = createHash('sha256').update(rawState).digest('hex');

    // 再把 state 入库，后续回调时可以做一次性消费校验。
    await context.storage.oauthStates.create({
      providerType: this.type,
      stateHash,
      redirectTo: typeof input?.redirectTo === 'string' ? input.redirectTo : undefined,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    // 最后拼接标准授权地址并返回给调用方。
    const url = new URL(this.getAuthorizationEndpoint());
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.getCallbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', rawState);
    url.searchParams.set('scope', (this.config.scope ?? this.getDefaultScope()).join(' '));

    return url.toString();
  }

  /**
   * 处理 OAuth 回调。
   */
  abstract handleCallback(input: { code: string; state: string }): Promise<ProviderAuthResult>;

  /**
   * 返回授权端点。
   */
  protected abstract getAuthorizationEndpoint(): string;

  /**
   * 返回默认 scope。
   */
  protected abstract getDefaultScope(): string[];

  /**
   * 校验并标准化 OAuth 回调 code。
   */
  protected ensureCallbackCode(rawCode: string): string {
    const code = rawCode.trim();
    if (!code) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_CODE_001,
        message: 'OAuth 回调缺少 code 参数',
        statusCode: 400,
      });
    }

    return code;
  }

  /**
   * 校验并一次性消费 OAuth 回调 state。
   */
  protected async consumeCallbackState(rawState: string): Promise<OAuthStateRecord> {
    const state = rawState.trim();
    if (!state) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_STATE_001,
        message: 'OAuth 回调缺少 state 参数',
        statusCode: 400,
      });
    }

    const context = this.ensureContext();
    const stateHash = createHash('sha256').update(state).digest('hex');

    // 关键步骤：原子消费 state，失败即视为无效、过期或已被使用。
    const consumedState = await context.storage.oauthStates.consumeByStateHash(stateHash, new Date());
    if (!consumedState) {
      throw new OmniAuthError({
        code: ERROR_CODES.OAUTH_STATE_002,
        message: 'OAuth state 无效、已过期或已被消费',
        statusCode: 400,
      });
    }

    return consumedState;
  }

  /**
   * 获取回调地址。
   */
  protected getCallbackUrl(): string {
    const context = this.ensureContext();
    return `${context.config.baseUrl}${context.config.routePrefix}/oauth/${this.type}/callback`;
  }

  /**
   * 获取已初始化的上下文。
   */
  protected ensureContext(): ProviderContext {
    if (!this.context) {
      throw new OmniAuthError({
        code: ERROR_CODES.PROVIDER_INIT_001,
        message: `${this.name} 尚未初始化`,
      });
    }

    return this.context;
  }
}
