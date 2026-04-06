import type { CreateIdentityInput, CreateUserInput, StorageAdapter } from '../../storage/storage-adapter.js';
import type { IdentityRecord, UserRecord } from '../../types/entities.js';

/**
 * 负责处理用户与身份之间的统一关系。
 */
export class IdentityService {
  private readonly storage: StorageAdapter;

  /**
   * 创建身份服务实例。
   */
  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  /**
   * 根据身份信息查找已绑定身份。
   */
  async findIdentity(providerType: string, providerSubject: string): Promise<IdentityRecord | null> {
    return this.storage.identities.findByProvider(providerType, providerSubject);
  }

  /**
   * 创建一个新的用户。
   */
  async createUser(input: CreateUserInput): Promise<UserRecord> {
    return this.storage.users.create(input);
  }

  /**
   * 创建一个新的身份记录。
   */
  async createIdentity(input: CreateIdentityInput): Promise<IdentityRecord> {
    return this.storage.identities.create(input);
  }

  /**
   * 更新最后登录时间。
   */
  async touchLastLogin(userId: string): Promise<void> {
    await this.storage.users.updateLastLoginAt(userId, new Date());
  }
}
