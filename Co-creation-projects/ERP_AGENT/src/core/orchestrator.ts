import { v4 as uuidv4 } from 'uuid';
import { LlmClient } from './llm-client';
import { conversationMemory } from './conversation-memory';
import type { ConversationSessionSnapshot } from './conversation-memory';
import { skillRegistry } from './skill-registry';
import { classifyIntent } from '../customer-service/intent-classifier';
import { logger } from '../logger';
import type {
  AgentResult,
  AgentStep,
  ChatMessage,
  FulfillmentLineInput,
  PurchaseApprovalRequest,
  SkillDef,
  SkillExecuteResult,
  ToolDef,
} from './types';

export interface OrchestratorStreamCallbacks {
  onTextDelta?: (delta: string) => void;
  onToolStart?: (payload: {
    stepIndex: number;
    toolCallId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    timestamp: string;
  }) => void;
  onToolComplete?: (step: AgentStep, stepIndex: number) => void;
  onApprovalRequest?: (approvalRequest: PurchaseApprovalRequest) => void;
  signal?: AbortSignal;
}

function getApprovalRequest(toolResult: unknown): PurchaseApprovalRequest | null {
  if (!toolResult || typeof toolResult !== 'object') {
    return null;
  }

  const approvalRequest = Reflect.get(toolResult, 'approvalRequest');
  if (
    approvalRequest &&
    typeof approvalRequest === 'object' &&
    Reflect.get(approvalRequest, 'status') === 'waiting_for_approval'
  ) {
    return approvalRequest as PurchaseApprovalRequest;
  }

  return null;
}

function splitTextIntoChunks(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const sentenceChunks = normalized
    .split(/(?<=[。！？!?；;])/u)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sentenceChunks.length > 1) {
    return sentenceChunks;
  }

  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += 24) {
    chunks.push(normalized.slice(index, index + 24));
  }
  return chunks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

export class OrchestratorAgent {
  private llmClient: LlmClient;
  private agentTools: ToolDef[] = [];

  private static readonly SYSTEM_PROMPT = `你是 QQPGERP 的智能调度助手，负责协调库存、发货、采购与供应商协同。
必须优先使用工具，不要脱离工具数据直接编造业务结论。
可用工具：
- query_inventory: 查询 SKU 或商品名称库存
- coordinate_logistics: 协调物流动作
- trigger_purchase: 触发采购补货动作
- notify_supplier: 协同供应商
- execute_fulfillment_flow: 执行固定履约流程，先发货，库存不足再转采购，再找供应商

优先级规则：
1. 用户命中已注册业务 skill 时，优先执行 skill。
2. 用户询问库存时，先调用 query_inventory；如果给的是 WGXB02000201、KC10737483 这类货号或 SKU，必须使用 sku 或 sku_codes 参数；只有自然语言商品名才使用 product_name 或 product_names。
3. query_inventory 返回 alertLevel 为 high_risk/ordinary 或 procurementRequired 为 true 时，必须继续调用 trigger_purchase 自动触发补货；调用参数映射为：sku_code=skuCode，deficit_qty=deficitQty，stock_warehouse_id=triggerWarehouse.warehouseId，stock_warehouse_name=triggerWarehouse.warehouseName，stock_warehouse_classification=triggerWarehouse.warehouseClassification，operation_team_id=triggerWarehouse.operationTeamId。
4. query_inventory 返回 alertLevel 为 high_risk/ordinary 时，最终回复必须明确说明已触发对应预警以及采购建单结果，不要只按本次 requiredQty 是否满足来判断。
5. 其他场景再按工具循环决策。

回复必须基于工具结果，使用简洁中文。`;

  constructor() {
    this.llmClient = new LlmClient();
  }

  registerAgentTool(tool: ToolDef): void {
    this.agentTools.push(tool);
    logger.debug({ toolName: tool.name }, 'Orchestrator 注册工具');
  }

  registerAgentTools(tools: ToolDef[]): void {
    tools.forEach((tool) => this.registerAgentTool(tool));
  }

  async chat(
    message: string,
    context?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<AgentResult> {
    return this.runChat(message, context, sessionId);
  }

  async chatStream(
    message: string,
    context?: Record<string, unknown>,
    sessionId?: string,
    callbacks?: OrchestratorStreamCallbacks,
  ): Promise<AgentResult> {
    return this.runChat(message, context, sessionId, callbacks);
  }

  async executeSkillByName(
    skillName: string,
    input: Record<string, unknown>,
    sessionId?: string,
  ): Promise<AgentResult> {
    const taskId = uuidv4();
    const skill = skillRegistry.get(skillName);

    if (!skill) {
      return {
        taskId,
        status: 'failed',
        result: `未找到 skill: ${skillName}`,
        steps: [],
        metadata: { skillName },
      };
    }

    return this.executeSkillInternal(taskId, skill, `执行技能 ${skill.name}`, input, sessionId);
  }

  async processOrder(orderId: number, sessionId?: string): Promise<AgentResult> {
    const message =
      `订单 ${orderId} 已审核通过，请按以下顺序处理：\n` +
      `1. 查询订单相关 SKU 库存\n` +
      `2. 能发货的先安排仓库发货\n` +
      `3. 库存不足的转采购补货\n` +
      `4. 采购后继续协调供应商`;

    return this.chat(message, { orderId, triggerType: 'order_approved' }, sessionId);
  }

  async processStockAlert(
    skuCode: string,
    currentQty: number,
    safetyQty: number,
    sessionId?: string,
  ): Promise<AgentResult> {
    const deficit = safetyQty - currentQty;
    const message =
      `SKU ${skuCode} 触发库存预警。\n` +
      `当前库存: ${currentQty}\n` +
      `安全库存: ${safetyQty}\n` +
      `缺口数量: ${deficit}\n` +
      `请触发采购补货，并在缺口严重时协调供应商。`;

    return this.chat(message, {
      skuCode,
      currentQty,
      safetyQty,
      deficit,
      triggerType: 'stock_alert',
    }, sessionId);
  }

  async processFulfillment(
    items: FulfillmentLineInput[],
    autoNotifySupplier = true,
    sessionId?: string,
  ): Promise<AgentResult> {
    return this.executeSkillByName('fulfillment_flow', { items, autoNotifySupplier }, sessionId);
  }

  async processCustomerServiceChat(
    message: string,
    customerContext?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<AgentResult> {
    return this.executeSkillByName(
      'customer_service_faq',
      { message, customerContext },
      sessionId,
    );
  }

  getConversationMemory(sessionId: string): ConversationSessionSnapshot | null {
    return conversationMemory.getSession(sessionId);
  }

  clearConversationMemory(sessionId: string): boolean {
    return conversationMemory.clear(sessionId);
  }

  private async runChat(
    message: string,
    context?: Record<string, unknown>,
    sessionId?: string,
    callbacks?: OrchestratorStreamCallbacks,
  ): Promise<AgentResult> {
    const taskId = uuidv4();
    const classification = classifyIntent(message, context);
    const matchedSkill = skillRegistry.findMatch(message, context);

    if (matchedSkill) {
      return this.executeSkill(taskId, matchedSkill, message, context, sessionId, callbacks);
    }

    const steps: AgentStep[] = [];
    const memoryMessages = sessionId ? conversationMemory.getMessages(sessionId) : [];
    const userContent = context
      ? `${message}\n\n附加上下文：${JSON.stringify(context, null, 2)}`
      : message;

    const messages: ChatMessage[] = [
      { role: 'system', content: OrchestratorAgent.SYSTEM_PROMPT },
      ...memoryMessages,
      { role: 'user', content: userContent },
    ];

    try {
      const result = await this.llmClient.runReActLoop(messages, this.agentTools, {
        signal: callbacks?.signal,
        onTextDelta: callbacks?.onTextDelta,
        onToolStart: callbacks?.onToolStart,
        onStep: (step, stepIndex) => {
          const nextStep = { ...step, stepIndex };
          steps.push(nextStep);
          callbacks?.onToolComplete?.(nextStep, stepIndex);

          const approvalRequest = getApprovalRequest(step.toolResult);
          if (approvalRequest) {
            callbacks?.onApprovalRequest?.(approvalRequest);
          }
        },
      });

      const finalResult = await this.enforceProcurementAfterInventory(result, steps, callbacks);
      const waitingApproval = this.findWaitingApprovalRequest(steps);
      this.saveConversationMemory(sessionId, message, finalResult);
      logger.info({ taskId, stepsCount: steps.length, sessionId }, 'Orchestrator 任务完成');
      return {
        taskId,
        status: waitingApproval ? 'waiting_for_approval' : 'completed',
        result: finalResult,
        steps,
        metadata: {
          intent: classification.intent,
          confidence: classification.confidence,
          approvalRequest: waitingApproval ?? undefined,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result = `处理失败: ${error}`;
      this.saveConversationMemory(sessionId, message, result);
      logger.error({ taskId, error }, 'Orchestrator 任务失败');
      return {
        taskId,
        status: 'failed',
        result,
        steps,
        metadata: { error },
      };
    }
  }

  private async executeSkill(
    taskId: string,
    skill: SkillDef,
    message: string,
    context?: Record<string, unknown>,
    sessionId?: string,
    callbacks?: OrchestratorStreamCallbacks,
  ): Promise<AgentResult> {
    const input = skill.buildInput(message, context);
    if (!input) {
      return {
        taskId,
        status: 'failed',
        result: `Skill ${skill.name} 无法从当前输入构建执行参数`,
        steps: [],
        metadata: { skillName: skill.name },
      };
    }

    return this.executeSkillInternal(taskId, skill, message, input, sessionId, callbacks);
  }

  private async executeSkillInternal(
    taskId: string,
    skill: SkillDef,
    memoryInputMessage: string,
    input: Record<string, unknown>,
    sessionId?: string,
    callbacks?: OrchestratorStreamCallbacks,
  ): Promise<AgentResult> {
    const stepIndex = 0;
    const toolName = `skill:${skill.name}`;
    const toolCallId = `skill-${taskId}`;
    callbacks?.onToolStart?.({
      stepIndex,
      toolCallId,
      toolName,
      toolArgs: input,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await skill.execute(input);
      const streamed = this.emitSkillText(result, callbacks);
      const skillStep: AgentStep = {
        stepIndex,
        toolCallId,
        toolName,
        toolArgs: input,
        toolResult: result.metadata,
        timestamp: new Date().toISOString(),
      };
      callbacks?.onToolComplete?.(skillStep, stepIndex);
      this.saveConversationMemory(sessionId, memoryInputMessage, streamed);
      return {
        taskId,
        status: 'completed',
        result: streamed,
        steps: [skillStep],
        metadata: {
          ...(result.metadata ?? {}),
          skillName: skill.name,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const failedStep: AgentStep = {
        stepIndex,
        toolCallId,
        toolName,
        toolArgs: input,
        toolResult: { error },
        error,
        timestamp: new Date().toISOString(),
      };
      callbacks?.onToolComplete?.(failedStep, stepIndex);
      this.saveConversationMemory(sessionId, memoryInputMessage, `Skill 执行失败: ${error}`);
      logger.error({ taskId, skillName: skill.name, error }, 'Skill 执行失败');
      return {
        taskId,
        status: 'failed',
        result: `Skill 执行失败: ${error}`,
        steps: [failedStep],
        metadata: { error, skillName: skill.name },
      };
    }
  }

  private emitSkillText(
    result: SkillExecuteResult,
    callbacks?: OrchestratorStreamCallbacks,
  ): string {
    const answer = result.result ?? '';
    for (const chunk of splitTextIntoChunks(answer)) {
      callbacks?.onTextDelta?.(chunk);
    }
    return answer;
  }

  private findWaitingApprovalRequest(steps: AgentStep[]): PurchaseApprovalRequest | null {
    for (const step of steps) {
      const approvalRequest = getApprovalRequest(step.toolResult);
      if (approvalRequest) {
        return approvalRequest;
      }
    }

    return null;
  }

  private async enforceProcurementAfterInventory(
    result: string,
    steps: AgentStep[],
    callbacks?: OrchestratorStreamCallbacks,
  ): Promise<string> {
    if (steps.some((step) => step.toolName === 'trigger_purchase')) {
      return result;
    }

    const triggerPurchaseTool = this.agentTools.find((tool) => tool.name === 'trigger_purchase');
    if (!triggerPurchaseTool) {
      return result;
    }

    const purchaseArgsList = this.buildPurchaseArgsFromInventorySteps(steps);
    if (purchaseArgsList.length === 0) {
      return result;
    }

    const summaries: string[] = [];
    for (const purchaseArgs of purchaseArgsList) {
      const stepIndex = steps.length;
      const toolCallId = `auto-trigger-purchase-${stepIndex}`;
      callbacks?.onToolStart?.({
        stepIndex,
        toolCallId,
        toolName: 'trigger_purchase',
        toolArgs: purchaseArgs,
        timestamp: new Date().toISOString(),
      });

      let toolResult: unknown;
      let error: string | undefined;
      try {
        toolResult = await triggerPurchaseTool.execute(purchaseArgs);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        toolResult = { error };
      }

      const step: AgentStep = {
        stepIndex,
        toolName: 'trigger_purchase',
        toolArgs: purchaseArgs,
        toolResult,
        error,
        timestamp: new Date().toISOString(),
      };
      steps.push(step);
      callbacks?.onToolComplete?.(step, stepIndex);

      const approvalRequest = getApprovalRequest(toolResult);
      if (approvalRequest) {
        callbacks?.onApprovalRequest?.(approvalRequest);
      }

      if (isRecord(toolResult)) {
        const summary = getString(toolResult['summary']);
        if (summary) {
          summaries.push(summary);
        }
      }
    }

    if (summaries.length === 0) {
      return result;
    }

    const appendText = `\n\n已自动触发采购补货：${summaries.join('；')}`;
    callbacks?.onTextDelta?.(appendText);
    return `${result}${appendText}`;
  }

  private buildPurchaseArgsFromInventorySteps(steps: AgentStep[]): Record<string, unknown>[] {
    const argsList: Record<string, unknown>[] = [];
    for (const step of steps) {
      if (step.toolName !== 'query_inventory' || !isRecord(step.toolResult)) {
        continue;
      }

      const decisions = step.toolResult['decisions'];
      if (!Array.isArray(decisions)) {
        continue;
      }

      for (const decision of decisions) {
        if (!isRecord(decision) || decision['procurementRequired'] !== true) {
          continue;
        }

        const skuCode = getString(decision['query']);
        const deficitQty = getNumber(decision['deficitQty']);
        if (!skuCode || !deficitQty) {
          continue;
        }

        const triggerWarehouse = isRecord(decision['triggerWarehouse'])
          ? decision['triggerWarehouse']
          : null;

        argsList.push({
          sku_code: skuCode,
          deficit_qty: deficitQty,
          is_urgent: decision['alertLevel'] === 'high_risk',
          stock_warehouse_id: getNumber(triggerWarehouse?.['warehouseId']),
          stock_warehouse_name: getString(triggerWarehouse?.['warehouseName']),
          stock_warehouse_classification: getNumber(triggerWarehouse?.['warehouseClassification']),
          operation_team_id: getNumber(triggerWarehouse?.['operationTeamId']),
        });
      }
    }

    return argsList;
  }

  private saveConversationMemory(
    sessionId: string | undefined,
    userMessage: string,
    assistantMessage: string,
  ): void {
    if (!sessionId || !assistantMessage) {
      return;
    }

    conversationMemory.appendExchange(sessionId, userMessage, assistantMessage);
  }
}

export const orchestrator = new OrchestratorAgent();
