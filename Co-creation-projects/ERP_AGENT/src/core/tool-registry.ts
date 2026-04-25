import type { ToolDef } from './types';
import { logger } from '../logger';

/**
 * 工具注册中心
 * 统一管理所有可被 LLM 调用的工具，支持按 Agent 分组注册
 */
export class ToolRegistry {
  private tools: Map<string, ToolDef> = new Map();

  /**
   * 注册单个工具
   */
  register(tool: ToolDef): void {
    if (this.tools.has(tool.name)) {
      logger.warn({ toolName: tool.name }, '工具名称重复，将覆盖已有工具');
    }
    this.tools.set(tool.name, tool);
    logger.debug({ toolName: tool.name }, '工具注册成功');
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: ToolDef[]): void {
    tools.forEach((t) => this.register(t));
  }

  /**
   * 获取所有工具列表（用于传入 LLM）
   */
  getAll(): ToolDef[] {
    return Array.from(this.tools.values());
  }

  /**
   * 按名称获取工具
   */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }
}

/** 全局单例工具注册中心 */
export const toolRegistry = new ToolRegistry();
