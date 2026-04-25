import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import type {
  AgentTask,
  AgentResult,
  AgentStep,
  ChatMessage,
  ToolDef,
  TaskStatus,
} from './types';

/**
 * Agent 抽象基类
 * 所有专业 Agent 继承此类，提供任务管理、步骤记录、错误处理等基础能力
 */
export abstract class AgentBase {
  /** Agent 名称（用于日志和调试） */
  abstract readonly name: string;

  /** 系统提示词，定义 Agent 角色和能力 */
  abstract readonly systemPrompt: string;

  /** 该 Agent 拥有的工具列表 */
  abstract readonly tools: ToolDef[];

  /**
   * 执行 Agent 主逻辑（子类实现）
   * @param task 当前任务
   * @returns 执行结果
   */
  abstract execute(task: AgentTask): Promise<AgentResult>;

  // ----------------------------------------------------------------
  // 任务管理辅助方法
  // ----------------------------------------------------------------

  /**
   * 创建新任务
   */
  protected createTask(
    type: AgentTask['type'],
    input: Record<string, unknown>,
  ): AgentTask {
    const now = new Date().toISOString();
    return {
      taskId: uuidv4(),
      type,
      input,
      status: 'pending',
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 记录步骤
   */
  protected addStep(task: AgentTask, step: Omit<AgentStep, 'timestamp'>): void {
    const fullStep: AgentStep = {
      ...step,
      timestamp: new Date().toISOString(),
    };
    task.steps.push(fullStep);
    task.updatedAt = fullStep.timestamp;
    logger.debug(
      { agentName: this.name, taskId: task.taskId, step: fullStep },
      'Agent 步骤记录',
    );
  }

  /**
   * 标记任务完成
   */
  protected completeTask(task: AgentTask, result: string): AgentResult {
    task.status = 'completed';
    task.result = result;
    task.updatedAt = new Date().toISOString();
    logger.info({ agentName: this.name, taskId: task.taskId }, 'Agent 任务完成');
    return {
      taskId: task.taskId,
      status: 'completed',
      result,
      steps: task.steps,
    };
  }

  /**
   * 标记任务失败
   */
  protected failTask(task: AgentTask, error: unknown): AgentResult {
    const errorMsg = error instanceof Error ? error.message : String(error);
    task.status = 'failed';
    task.result = `执行失败: ${errorMsg}`;
    task.updatedAt = new Date().toISOString();
    logger.error(
      { agentName: this.name, taskId: task.taskId, error: errorMsg },
      'Agent 任务失败',
    );
    return {
      taskId: task.taskId,
      status: 'failed' as TaskStatus,
      result: task.result,
      steps: task.steps,
      metadata: { error: errorMsg },
    };
  }

  /**
   * 构建带系统提示的初始消息
   */
  protected buildMessages(userContent: string): ChatMessage[] {
    return [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userContent },
    ];
  }
}
