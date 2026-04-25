import pino from 'pino';
import { getConfig } from './config';

/**
 * 结构化日志实例（全局单例）
 * 生产环境输出 JSON，开发环境使用 pino-pretty 格式化
 */
export const logger = pino({
  level: getConfig().logLevel,
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});
