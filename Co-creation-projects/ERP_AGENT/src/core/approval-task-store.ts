import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config';
import type {
  ApprovalTask,
  ApprovalTaskStatus,
  PurchaseApprovalRequest,
} from './types';

interface ApprovalTaskFile {
  tasks: ApprovalTask[];
}

interface CreateApprovalTaskInput {
  request: Omit<PurchaseApprovalRequest, 'taskId' | 'status' | 'expiresAt'>;
  sessionId?: string;
}

interface UpdateApprovalTaskInput {
  status?: ApprovalTaskStatus;
  request?: PurchaseApprovalRequest;
  result?: string;
  workflowResult?: Record<string, unknown>;
  errorMessage?: string;
  approvedBy?: {
    operatorId?: string;
    operatorName?: string;
  };
  historyNote?: string;
}

export class ApprovalTaskStore {
  private readonly filePath: string;
  private readonly timeoutMs: number;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = getConfig().approvalTaskStoragePath, timeoutMs = getConfig().approvalTaskTimeoutMs) {
    this.filePath = filePath;
    this.timeoutMs = timeoutMs;
  }

  async createPurchaseApprovalTask(input: CreateApprovalTaskInput): Promise<ApprovalTask> {
    const tasks = await this.readTasks();
    const existing = tasks.find((item) => item.approvalId === input.request.approvalId);
    if (existing && ['waiting_for_approval', 'approved', 'running'].includes(existing.status)) {
      return existing;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.timeoutMs).toISOString();
    const taskId = uuidv4();
    const request: PurchaseApprovalRequest = {
      ...input.request,
      taskId,
      status: 'waiting_for_approval',
      expiresAt,
    };
    const task: ApprovalTask = {
      taskId,
      approvalId: request.approvalId,
      workflowName: 'purchase_apply_full_approval',
      status: 'waiting_for_approval',
      request,
      sessionId: input.sessionId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt,
      history: [
        {
          status: 'waiting_for_approval',
          at: now.toISOString(),
          note: 'Agent 创建审批任务，等待用户授权',
        },
      ],
    };

    tasks.push(task);
    await this.writeTasks(tasks);
    return task;
  }

  async list(filters: { sessionId?: string; status?: ApprovalTaskStatus } = {}): Promise<ApprovalTask[]> {
    await this.expireOverdueTasks();
    const tasks = await this.readTasks();
    return tasks.filter((task) => {
      if (filters.sessionId && task.sessionId !== filters.sessionId) {
        return false;
      }

      if (filters.status && task.status !== filters.status) {
        return false;
      }

      return true;
    });
  }

  async get(approvalId: string): Promise<ApprovalTask | null> {
    await this.expireOverdueTasks();
    const tasks = await this.readTasks();
    return tasks.find((task) => task.approvalId === approvalId) ?? null;
  }

  async update(approvalId: string, input: UpdateApprovalTaskInput): Promise<ApprovalTask> {
    const tasks = await this.readTasks();
    const index = tasks.findIndex((task) => task.approvalId === approvalId);
    if (index < 0) {
      throw new Error(`审批任务不存在: ${approvalId}`);
    }

    const current = tasks[index];
    const now = new Date().toISOString();
    const nextStatus = input.status ?? current.status;
    const nextTask: ApprovalTask = {
      ...current,
      status: nextStatus,
      request: input.request ? { ...input.request, status: nextStatus } : { ...current.request, status: nextStatus },
      result: input.result ?? current.result,
      workflowResult: input.workflowResult ?? current.workflowResult,
      errorMessage: input.errorMessage ?? current.errorMessage,
      approvedBy: input.approvedBy ?? current.approvedBy,
      approvedAt: input.approvedBy ? now : current.approvedAt,
      updatedAt: now,
      history: [
        ...current.history,
        {
          status: nextStatus,
          at: now,
          operatorId: input.approvedBy?.operatorId,
          operatorName: input.approvedBy?.operatorName,
          note: input.historyNote,
        },
      ],
    };

    tasks[index] = nextTask;
    await this.writeTasks(tasks);
    return nextTask;
  }

  async patchRequest(
    approvalId: string,
    patch: Partial<Pick<PurchaseApprovalRequest, 'qty'>>,
  ): Promise<ApprovalTask> {
    const task = await this.get(approvalId);
    if (!task) {
      throw new Error(`审批任务不存在: ${approvalId}`);
    }

    if (task.status !== 'waiting_for_approval') {
      throw new Error(`审批任务当前状态为 ${task.status}，不能修改`);
    }

    const qty = patch.qty;
    const request = {
      ...task.request,
      qty: typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? qty : task.request.qty,
    };

    return this.update(approvalId, {
      request,
      historyNote: '审批前更新任务参数',
    });
  }

  private async expireOverdueTasks(): Promise<void> {
    const tasks = await this.readTasks();
    const now = Date.now();
    let changed = false;
    const nextTasks = tasks.map((task) => {
      if (
        task.status === 'waiting_for_approval' &&
        task.expiresAt &&
        new Date(task.expiresAt).getTime() < now
      ) {
        changed = true;
        return {
          ...task,
          status: 'expired' as const,
          request: { ...task.request, status: 'expired' as const },
          updatedAt: new Date().toISOString(),
          history: [
            ...task.history,
            {
              status: 'expired' as const,
              at: new Date().toISOString(),
              note: '审批任务超时',
            },
          ],
        };
      }

      return task;
    });

    if (changed) {
      await this.writeTasks(nextTasks);
    }
  }

  private async readTasks(): Promise<ApprovalTask[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ApprovalTaskFile;
      return Array.isArray(parsed.tasks) ? parsed.tasks : [];
    } catch (error) {
      const code = typeof error === 'object' && error ? Reflect.get(error, 'code') : undefined;
      if (code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private async writeTasks(tasks: ApprovalTask[]): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify({ tasks }, null, 2), 'utf8');
      await fs.rename(tmpPath, this.filePath);
    });

    await this.writeQueue;
  }
}

export const approvalTaskStore = new ApprovalTaskStore();
