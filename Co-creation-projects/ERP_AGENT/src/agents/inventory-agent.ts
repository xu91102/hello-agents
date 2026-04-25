import { AgentBase } from '../core/agent-base';
import { LlmClient } from '../core/llm-client';
import { inventoryApi } from '../api/inventory-api';
import { logger } from '../logger';
import type { AgentTask, AgentResult, ToolDef, InventoryDecision } from '../core/types';

/**
 * 库存查询 Agent
 *
 * 职责：
 * - 查询 SKU 在各仓库的实时可用库存
 * - 跨仓库聚合库存数据
 * - 判断库存是否满足需求（充足/不足/为零）
 */
export class InventoryAgent extends AgentBase {
  readonly name = 'InventoryAgent';
  readonly systemPrompt = `你是 QQPGERP 库存查询专家。
你的任务是查询商品库存，并判断是否满足发货需求。
调用工具后，请分析结果并给出明确的库存状态判断。
用中文回复，格式为：SKU-xxx: 可用库存 N，状态：充足/不足/缺货`;

  private llmClient: LlmClient;

  readonly tools: ToolDef[] = [
    {
      name: 'get_sku_stock',
      description: '查询指定 SKU 在所有仓库的库存数量和可用数量',
      parameters: {
        type: 'object',
        properties: {
          sku_code: { type: 'string', description: 'SKU 编码，例如 SKU-001' },
        },
        required: ['sku_code'],
      },
      execute: async (args) => {
        const skuCode = args['sku_code'] as string;
        logger.info({ skuCode }, '库存查询工具调用');
        const stocks = await inventoryApi.getStockBySku(skuCode);
        const totalAvailable = stocks.reduce((sum, s) => sum + s.availableQty, 0);
        return {
          skuCode,
          warehouses: stocks,
          totalAvailable,
          summary: `${skuCode} 在 ${stocks.length} 个仓库合计可用库存：${totalAvailable}`,
        };
      },
    },
    {
      name: 'batch_get_stock',
      description: '批量查询多个 SKU 的库存，效率高于逐个查询',
      parameters: {
        type: 'object',
        properties: {
          sku_codes: {
            type: 'array',
            description: 'SKU 编码列表',
            items: { type: 'string', description: 'SKU 编码' },
          },
        },
        required: ['sku_codes'],
      },
      execute: async (args) => {
        const skuCodes = args['sku_codes'] as string[];
        logger.info({ skuCodes }, '批量库存查询工具调用');
        const stocks = await inventoryApi.getBatchStock(skuCodes);
        const grouped = skuCodes.map((sku) => {
          const skuStocks = stocks.filter((s) => s.skuCode === sku);
          const totalAvailable = skuStocks.reduce((sum, s) => sum + s.availableQty, 0);
          return { skuCode: sku, totalAvailable, warehouses: skuStocks };
        });
        return { results: grouped };
      },
    },
  ];

  constructor() {
    super();
    this.llmClient = new LlmClient();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const { skuCodes, requiredQtys } = task.input as {
      skuCodes: string[];
      requiredQtys?: Record<string, number>;
    };

    this.addStep(task, {
      stepIndex: 0,
      thought: `开始查询 ${skuCodes.length} 个 SKU 的库存`,
    });

    try {
      task.status = 'running';
      const messages = this.buildMessages(
        `请查询以下 SKU 的库存：${skuCodes.join(', ')}` +
          (requiredQtys
            ? `\n需求数量：${JSON.stringify(requiredQtys)}`
            : ''),
      );

      const result = await this.llmClient.runReActLoop(
        messages,
        this.tools,
        (step, idx) => this.addStep(task, { ...step, stepIndex: idx + 1 }),
      );

      return this.completeTask(task, result);
    } catch (err) {
      return this.failTask(task, err);
    }
  }

  /**
   * 快捷方法：直接查询并返回结构化库存决策（不经过 LLM，用于确定性场景）
   */
  async queryAndDecide(
    skuCode: string,
    requiredQty: number,
  ): Promise<InventoryDecision> {
    const stocks = await inventoryApi.getStockBySku(skuCode);
    const availableQty = stocks.reduce((sum, s) => sum + s.availableQty, 0);

    let status: InventoryDecision['status'];
    if (availableQty === 0) {
      status = 'empty';
    } else if (availableQty >= requiredQty) {
      status = 'sufficient';
    } else {
      status = 'insufficient';
    }

    logger.info({ skuCode, requiredQty, availableQty, status }, '库存决策完成');
    return { skuCode, requiredQty, availableQty, status };
  }
}

export const inventoryAgent = new InventoryAgent();
