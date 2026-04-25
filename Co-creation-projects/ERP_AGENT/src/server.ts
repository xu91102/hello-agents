import express, { NextFunction, Request, Response } from 'express';
import { orchestrator } from './core/orchestrator';
import { skillRegistry } from './core/skill-registry';
import { approvalTaskStore } from './core/approval-task-store';
import { purchaseApprovalWorkflow } from './core/purchase-approval-workflow';
import { erpClient } from './api/erp-client';
import { logger } from './logger';
import type { ApprovalTaskStatus } from './core/types';

function validateFulfillmentItems(items: unknown): items is Array<{ skuCode: string; requiredQty: number }> {
  return (
    Array.isArray(items) &&
    items.length > 0 &&
    !items.find(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof Reflect.get(item, 'skuCode') !== 'string' ||
        !Reflect.get(item, 'skuCode') ||
        typeof Reflect.get(item, 'requiredQty') !== 'number' ||
        (Reflect.get(item, 'requiredQty') as number) <= 0,
    )
  );
}

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data ?? null)}\n\n`);
  (res as Response & { flush?: () => void }).flush?.();
}

function toSummary(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createApp(): express.Application {
  const app = express();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Requested-With',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const agentRouter = express.Router();
  const agentAssistantRouter = express.Router();

  async function handleListApprovals(req: Request, res: Response): Promise<void> {
    const sessionId = typeof req.query['sessionId'] === 'string' ? req.query['sessionId'] : undefined;
    const status = typeof req.query['status'] === 'string'
      ? req.query['status'] as ApprovalTaskStatus
      : undefined;
    const items = await approvalTaskStore.list({ sessionId, status });
    res.json({ items, total: items.length });
  }

  async function handleGetApproval(req: Request, res: Response): Promise<void> {
    const approvalId = req.params['approvalId'] ?? '';
    const task = await approvalTaskStore.get(approvalId);
    if (!task) {
      res.status(404).json({ error: '审批任务不存在或已过期', approvalId });
      return;
    }

    res.json(task);
  }

  async function handlePatchApproval(req: Request, res: Response): Promise<void> {
    const approvalId = req.params['approvalId'] ?? '';
    const qty = typeof req.body?.qty === 'number' ? req.body.qty : undefined;
    const task = await approvalTaskStore.patchRequest(approvalId, { qty });
    res.json(task);
  }

  async function handleApproveApproval(req: Request, res: Response): Promise<void> {
    const approvalId = req.params['approvalId'] ?? '';
    const approvedQty = typeof req.body?.approvedQty === 'number'
      ? req.body.approvedQty
      : typeof req.body?.qty === 'number'
        ? req.body.qty
        : undefined;
    const operatorId = typeof req.body?.operatorId === 'string' ? req.body.operatorId : undefined;
    const operatorName = typeof req.body?.operatorName === 'string' ? req.body.operatorName : undefined;
    const result = await erpClient.runWithAuthorization(req.headers.authorization, () =>
      purchaseApprovalWorkflow.approve({
        approvalId,
        approvedQty,
        operatorId,
        operatorName,
      }),
    );
    res.json(result);
  }

  async function handleCancelApproval(req: Request, res: Response): Promise<void> {
    const approvalId = req.params['approvalId'] ?? '';
    const operatorName = typeof req.body?.operatorName === 'string' ? req.body.operatorName : undefined;
    const task = await purchaseApprovalWorkflow.cancel(approvalId, operatorName);
    res.json(task);
  }

  async function handleRejectApproval(req: Request, res: Response): Promise<void> {
    const approvalId = req.params['approvalId'] ?? '';
    const operatorId = typeof req.body?.operatorId === 'string' ? req.body.operatorId : undefined;
    const operatorName = typeof req.body?.operatorName === 'string' ? req.body.operatorName : undefined;
    const remark = typeof req.body?.remark === 'string' ? req.body.remark : undefined;
    const result = await erpClient.runWithAuthorization(req.headers.authorization, () =>
      purchaseApprovalWorkflow.reject(approvalId, {
        operatorId,
        operatorName,
        remark,
      }),
    );
    res.json(result);
  }

  agentAssistantRouter.post('/StreamMessage', async (req: Request, res: Response) => {
    const { message, conversationId, pageContext } = req.body as {
      message?: string;
      conversationId?: string;
      pageContext?: Record<string, unknown>;
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message 字段为必填字符串' });
      return;
    }

    const sessionId =
      typeof conversationId === 'string' && conversationId
        ? conversationId
        : `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    (res as Response & { flush?: () => void }).flush?.();

    const abortController = new AbortController();
    const toolCallIdMap = new Map<string, string>();
    let hasTextDeltaSent = false;
    let closed = false;
    req.on('aborted', () => {
      closed = true;
      abortController.abort();
    });
    res.on('close', () => {
      closed = true;
      abortController.abort();
    });

    try {
      writeSseEvent(res, 'conversation.created', { conversationId: sessionId });

      const result = await orchestrator.chatStream(
        message,
        { pageContext },
        sessionId,
        {
          signal: abortController.signal,
          onTextDelta: (delta) => {
            if (!closed && delta) {
              hasTextDeltaSent = true;
              writeSseEvent(res, 'message.delta', { delta });
            }
          },
          onToolStart: (payload) => {
            if (closed) {
              return;
            }

            const toolKey = `${payload.stepIndex}:${payload.toolName}:${JSON.stringify(payload.toolArgs ?? {})}`;
            toolCallIdMap.set(toolKey, payload.toolCallId);

            writeSseEvent(res, 'tool.started', {
              toolCallId: payload.toolCallId,
              toolName: payload.toolName,
              inputSummary: toSummary(payload.toolArgs),
              outputSummary: '',
            });
          },
          onToolComplete: (step, stepIndex) => {
            if (closed || !step.toolName) {
              return;
            }

            const toolKey = `${stepIndex}:${step.toolName}:${JSON.stringify(step.toolArgs ?? {})}`;
            const toolCallId =
              step.toolCallId ??
              toolCallIdMap.get(toolKey) ??
              `${sessionId}-${stepIndex}-${step.toolName}`;

            writeSseEvent(res, step.error ? 'tool.failed' : 'tool.completed', {
              toolCallId,
              toolName: step.toolName,
              inputSummary: toSummary(step.toolArgs),
              outputSummary: toSummary(step.toolResult),
              errorMessage: step.error,
            });
          },
          onApprovalRequest: (approvalRequest) => {
            if (!closed) {
              writeSseEvent(res, 'approval.requested', approvalRequest);
            }
          },
        },
      );

      if (!closed) {
        if (!hasTextDeltaSent && result.result) {
          writeSseEvent(res, 'message.delta', { delta: result.result });
        }

        writeSseEvent(res, 'message.completed', {
          taskId: result.taskId,
          status: result.status,
          metadata: result.metadata,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'AgentAssistant StreamMessage 处理失败');
      if (!closed) {
        writeSseEvent(res, 'message.error', { errorMessage });
      }
    } finally {
      res.end();
    }
  });

  agentAssistantRouter.get('/Approvals', (req: Request, res: Response, next: NextFunction) => {
    handleListApprovals(req, res).catch(next);
  });

  agentAssistantRouter.get('/Approvals/:approvalId', (req: Request, res: Response, next: NextFunction) => {
    handleGetApproval(req, res).catch(next);
  });

  agentAssistantRouter.patch('/Approvals/:approvalId', (req: Request, res: Response, next: NextFunction) => {
    handlePatchApproval(req, res).catch(next);
  });

  agentAssistantRouter.post('/Approvals/:approvalId/Approve', (req: Request, res: Response, next: NextFunction) => {
    handleApproveApproval(req, res).catch(next);
  });

  agentAssistantRouter.post('/Approvals/:approvalId/Cancel', (req: Request, res: Response, next: NextFunction) => {
    handleCancelApproval(req, res).catch(next);
  });

  agentAssistantRouter.post('/Approvals/:approvalId/Reject', (req: Request, res: Response, next: NextFunction) => {
    handleRejectApproval(req, res).catch(next);
  });

  agentRouter.post('/chat', async (req: Request, res: Response) => {
    const { message, context, sessionId } = req.body as {
      message?: string;
      context?: Record<string, unknown>;
      sessionId?: string;
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message 字段为必填字符串' });
      return;
    }

    const result = await orchestrator.chat(message, context, sessionId);
    res.json(result);
  });

  agentRouter.post('/customer-service/chat', async (req: Request, res: Response) => {
    const { message, sessionId, customerContext } = req.body as {
      message?: string;
      sessionId?: string;
      customerContext?: Record<string, unknown>;
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message 字段为必填字符串' });
      return;
    }

    const result = await orchestrator.processCustomerServiceChat(
      message,
      customerContext,
      sessionId,
    );
    res.json(result);
  });

  agentRouter.get('/approvals', (req: Request, res: Response, next: NextFunction) => {
    handleListApprovals(req, res).catch(next);
  });

  agentRouter.get('/approvals/:approvalId', (req: Request, res: Response, next: NextFunction) => {
    handleGetApproval(req, res).catch(next);
  });

  agentRouter.patch('/approvals/:approvalId', (req: Request, res: Response, next: NextFunction) => {
    handlePatchApproval(req, res).catch(next);
  });

  agentRouter.post('/approvals/:approvalId/approve', (req: Request, res: Response, next: NextFunction) => {
    handleApproveApproval(req, res).catch(next);
  });

  agentRouter.post('/approvals/:approvalId/cancel', (req: Request, res: Response, next: NextFunction) => {
    handleCancelApproval(req, res).catch(next);
  });

  agentRouter.post('/approvals/:approvalId/reject', (req: Request, res: Response, next: NextFunction) => {
    handleRejectApproval(req, res).catch(next);
  });

  agentRouter.get('/memory/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params['sessionId'] ?? '';
    const memory = orchestrator.getConversationMemory(sessionId);
    if (!memory) {
      res.status(404).json({ error: 'session 不存在或已过期', sessionId });
      return;
    }

    res.json(memory);
  });

  agentRouter.delete('/memory/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params['sessionId'] ?? '';
    const cleared = orchestrator.clearConversationMemory(sessionId);
    res.json({ sessionId, cleared });
  });

  agentRouter.get('/skills', (_req: Request, res: Response) => {
    const skills = skillRegistry.getAll().map((skill) => ({
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers,
    }));

    res.json({ items: skills, total: skills.length });
  });

  agentRouter.post('/skills/:skillName/execute', async (req: Request, res: Response) => {
    const skillName = req.params['skillName'] ?? '';
    const { sessionId, ...input } = (req.body ?? {}) as Record<string, unknown>;
    const result = await orchestrator.executeSkillByName(
      skillName,
      input,
      typeof sessionId === 'string' ? sessionId : undefined,
    );
    res.json(result);
  });

  agentRouter.post('/order/:orderId/process', async (req: Request, res: Response) => {
    const orderId = parseInt(req.params['orderId'] ?? '', 10);
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    if (isNaN(orderId)) {
      res.status(400).json({ error: 'orderId 必须为有效数字' });
      return;
    }

    const result = await orchestrator.processOrder(orderId, sessionId);
    res.json(result);
  });

  agentRouter.post('/stock-alert', async (req: Request, res: Response) => {
    const { skuCode, currentQty, safetyQty, sessionId } = req.body as {
      skuCode?: string;
      currentQty?: number;
      safetyQty?: number;
      sessionId?: string;
    };

    if (!skuCode || currentQty === undefined || safetyQty === undefined) {
      res.status(400).json({ error: 'skuCode、currentQty、safetyQty 为必填字段' });
      return;
    }

    const result = await orchestrator.processStockAlert(
      skuCode,
      currentQty,
      safetyQty,
      sessionId,
    );
    res.json(result);
  });

  agentRouter.post('/fulfillment', async (req: Request, res: Response) => {
    const { items, autoNotifySupplier, sessionId } = req.body as {
      items?: Array<{ skuCode?: string; requiredQty?: number }>;
      autoNotifySupplier?: boolean;
      sessionId?: string;
    };

    if (!validateFulfillmentItems(items)) {
      res.status(400).json({ error: 'items 中每项都必须包含 skuCode 和正数 requiredQty' });
      return;
    }

    const result = await orchestrator.processFulfillment(items, autoNotifySupplier ?? true, sessionId);
    res.json(result);
  });

  app.use('/api/agent', agentRouter);
  app.use('/api/AgentAssistant', agentAssistantRouter);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ error: err.message }, '未捕获的请求错误');
    res.status(500).json({ error: '服务器内部错误', message: err.message });
  });

  return app;
}
