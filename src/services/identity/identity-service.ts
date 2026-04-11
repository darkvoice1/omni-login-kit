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
   * 根据身份 ID 查找身份记录。
   */
  async findIdentityById(identityId: string): Promise<IdentityRecord | null> {
    return this.storage.identities.findById(identityId);
  }

  /**
   * 根据身份信息查找已绑定身份。
   */
  async findIdentity(providerType: string, providerSubject: string): Promise<IdentityRecord | null> {
    return this.storage.identities.findByProvider(providerType, providerSubject);
  }

  /**
   * 列出某个用户已绑定的全部身份。
   */
  async listUserIdentities(userId: string): Promise<IdentityRecord[]> {
    return this.storage.identities.listByUserId(userId);
  }

  /**
   * 删除一条身份绑定记录。
   */
  async deleteIdentity(identityId: string): Promise<void> {
    await this.storage.identities.deleteById(identityId);
  }

  /**
   * 根据用户 ID 查找统一用户主体。
   */
  async findUserById(userId: string): Promise<UserRecord | null> {
    return this.storage.users.findById(userId);
  }

  /**
   * 根据邮箱查找统一用户主体。
   */
  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.storage.users.findByEmail(email);
  }

  /**
   * 根据手机号查找统一用户主体。
   */
  async findUserByPhone(phone: string): Promise<UserRecord | null> {
    return this.storage.users.findByPhone(phone);
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
