import OpenAI from 'openai';
import { getConfig } from '../config';
import { logger } from '../logger';
import type {
  ChatMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolDef,
  AgentStep,
  ToolCallInfo,
} from './types';

export interface ToolStartEvent {
  stepIndex: number;
  toolCallId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  timestamp: string;
}

export interface RunReActLoopOptions {
  onStep?: (step: AgentStep, stepIndex: number) => void;
  onToolStart?: (event: ToolStartEvent) => void;
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

/**
 * LLM 客户端
 * 封装 OpenAI Function Calling，支持多轮工具调用循环（ReAct 模式）
 */
export class LlmClient {
  private client: OpenAI;
  private model: string;
  private maxSteps: number;

  constructor() {
    const cfg = getConfig();
    this.client = new OpenAI({
      apiKey: cfg.openaiApiKey || 'ollama',
      baseURL: cfg.llmBaseUrl || undefined,
      timeout: cfg.llmTimeoutMs,
    });
    this.model = cfg.llmModel;
    this.maxSteps = cfg.maxAgentSteps;
  }

  /**
   * 执行 ReAct 循环：思考 -> 工具调用 -> 观察 -> 循环直到得出最终答案
   */
  async runReActLoop(
    messages: ChatMessage[],
    tools: ToolDef[],
    optionsOrOnStep?: RunReActLoopOptions | ((step: AgentStep, stepIndex: number) => void),
  ): Promise<string> {
    const history: ChatMessage[] = [...messages];
    const openaiTools = this.buildOpenAITools(tools);
    const options =
      typeof optionsOrOnStep === 'function'
        ? { onStep: optionsOrOnStep }
        : (optionsOrOnStep ?? {});
    let stepIndex = 0;

    while (stepIndex < this.maxSteps) {
      logger.debug({ stepIndex, historyLength: history.length }, 'LLM 请求开始');

      const assistantMsg = await this.createAssistantMessage(
        history,
        openaiTools,
        options.onTextDelta,
        options.signal,
      );

      history.push(assistantMsg);

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        const finalAnswer = assistantMsg.content ?? '';
        logger.debug({ stepIndex }, 'LLM 返回最终答案');
        return finalAnswer;
      }

      const toolResults = await this.executeToolCalls(
        assistantMsg.tool_calls,
        tools,
        stepIndex,
        options,
      );

      history.push(...toolResults);
      stepIndex++;
    }

    logger.warn({ maxSteps: this.maxSteps }, '达到最大步骤限制，强制结束');
    return '已达到最大思考步数，请简化您的请求后重试。';
  }

  private async createAssistantMessage(
    history: ChatMessage[],
    openaiTools: OpenAI.Chat.ChatCompletionTool[],
    onTextDelta?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AssistantMessage> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: history as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: openaiTools,
        tool_choice: 'auto',
      },
      signal ? { signal } : undefined,
    );

    const assistantMsg = response.choices[0]?.message;
    const normalizedToolCalls = (assistantMsg?.tool_calls ?? []).map((toolCall) => ({
      id: toolCall.id,
      type: 'function' as const,
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    } satisfies ToolCallInfo));

    const content = assistantMsg?.content ?? '';
    if (content) {
      for (const chunk of this.splitTextChunks(content)) {
        onTextDelta?.(chunk);
      }
    }

    return {
      role: 'assistant',
      content: content || null,
      tool_calls: normalizedToolCalls.length ? normalizedToolCalls : undefined,
    };
  }

  private splitTextChunks(content: string): string[] {
    const normalized = content.trim();
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

  /**
   * 执行所有工具调用，返回工具结果消息列表
   */
  private async executeToolCalls(
    toolCalls: ToolCallInfo[],
    tools: ToolDef[],
    stepIndex: number,
    options?: RunReActLoopOptions,
  ): Promise<ToolResultMessage[]> {
    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        const toolName = tc.function.name;
        let toolArgs: Record<string, unknown> = {};
        let toolResult: unknown;
        let error: string | undefined;

        try {
          toolArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          options?.onToolStart?.({
            stepIndex,
            toolCallId: tc.id,
            toolName,
            toolArgs,
            timestamp: new Date().toISOString(),
          });

          const tool = tools.find((t) => t.name === toolName);
          if (!tool) {
            throw new Error(`工具 "${toolName}" 未注册`);
          }

          logger.info({ toolName, toolArgs }, '执行工具调用');
          toolResult = await tool.execute(toolArgs);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          toolResult = { error };
          logger.error({ toolName, error }, '工具调用失败');
        }

        const step: AgentStep = {
          stepIndex,
          toolName,
          toolArgs,
          toolResult,
          error,
          timestamp: new Date().toISOString(),
        };
        options?.onStep?.(step, stepIndex);

        return {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        };
      }),
    );

    return results;
  }

  /**
   * 将内部 ToolDef 转换为 OpenAI tools 格式
   */
  private buildOpenAITools(
    tools: ToolDef[],
  ): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as unknown as Record<string, unknown>,
      },
    }));
  }
}
