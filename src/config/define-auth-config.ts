import type { OmniAuthConfig } from '../types/auth-config.js';
import { loadAuthConfig } from './load-auth-config.js';

/**
 * 定义认证配置，并在启动阶段完成基础校验。
 */
export function defineAuthConfig(config: OmniAuthConfig): OmniAuthConfig {
  return loadAuthConfig(config);
}
