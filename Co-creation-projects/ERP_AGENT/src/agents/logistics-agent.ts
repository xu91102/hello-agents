import { AgentBase } from '../core/agent-base';
import { LlmClient } from '../core/llm-client';
import { logisticsApi } from '../api/logistics-api';
import { logger } from '../logger';
import type { AgentTask, AgentResult, ToolDef, OutOrder } from '../core/types';

/**
 * 物流协调 Agent
 *
 * 职责：
 * - 根据订单目的国和商品重量，匹配最优物流渠道
 * - 创建出库单并推送到外部 WMS
 * - 追踪物流状态
 */
export class LogisticsAgent extends AgentBase {
  readonly name = 'LogisticsAgent';
  readonly systemPrompt = `你是 QQPGERP 物流协调专家。
你的任务是为订单选择最优物流渠道并创建出库单。
渠道选择优先级：目的国覆盖 > 时效 > 成本。
操作完成后，汇报出库单号和选中的物流渠道。`;

  private llmClient: LlmClient;

  readonly tools: ToolDef[] = [
    {
      name: 'get_logistics_channels',
      description: '查询可用的物流渠道列表，可按目的国筛选',
      parameters: {
        type: 'object',
        properties: {
          destination_country: {
            type: 'string',
            description: '目的国家代码，如 US、GB、SG',
          },
          warehouse_id: {
            type: 'number',
            description: '发货仓库 ID（可选）',
          },
        },
      },
      execute: async (args) => {
        logger.info({ args }, '查询物流渠道');
        const channels = await logisticsApi.getChannels({
          destinationCountry: args['destination_country'] as string | undefined,
          warehouseId: args['warehouse_id'] as number | undefined,
        });
        return {
          count: channels.length,
          channels: channels.map((c) => ({
            channelId: c.channelId,
            channelName: c.channelName,
            providerName: c.providerName,
            estimatedDays: c.estimatedDays,
            costPerKg: c.costPerKg,
          })),
        };
      },
    },
    {
      name: 'create_out_order',
      description: '创建出库单，将订单商品分配到指定物流渠道',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: '销售订单 ID' },
          channel_id: { type: 'number', description: '物流渠道 ID' },
          warehouse_id: { type: 'number', description: '出货仓库 ID' },
          sku_list: {
            type: 'array',
            description: 'SKU 列表，每项包含 sku_code 和 qty',
            items: { type: 'object', description: '{ sku_code: string, qty: number }' },
          },
        },
        required: ['order_id', 'channel_id', 'warehouse_id', 'sku_list'],
      },
      execute: async (args) => {
        logger.info({ args }, '创建出库单');
        const outOrder = await logisticsApi.createOutOrder({
          orderId: args['order_id'] as number,
          channelId: args['channel_id'] as number,
          warehouseId: args['warehouse_id'] as number,
          skuList: args['sku_list'] as Array<{ skuCode: string; qty: number }>,
        });
        return {
          outOrderId: outOrder.outOrderId,
          channelName: outOrder.channelName,
          status: outOrder.status,
          message: `出库单 #${outOrder.outOrderId} 已创建，物流渠道：${outOrder.channelName}`,
        };
      },
    },
    {
      name: 'push_to_wms',
      description: '将出库单推送到外部 WMS 仓库管理系统，触发实际拣货发货',
      parameters: {
        type: 'object',
        properties: {
          out_order_id: { type: 'number', description: '出库单 ID' },
        },
        required: ['out_order_id'],
      },
      execute: async (args) => {
        const outOrderId = args['out_order_id'] as number;
        logger.info({ outOrderId }, '推送出库单到 WMS');
        const result = await logisticsApi.pushToWms(outOrderId);
        return {
          success: result.success,
          trackingNo: result.trackingNo,
          message: result.success
            ? `WMS 推送成功，运单号：${result.trackingNo ?? '待生成'}`
            : 'WMS 推送失败，请人工处理',
        };
      },
    },
  ];

  constructor() {
    super();
    this.llmClient = new LlmClient();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const { orderId, destinationCountry, skuList, warehouseId } = task.input as {
      orderId: number;
      destinationCountry: string;
      skuList: Array<{ skuCode: string; qty: number }>;
      warehouseId: number;
    };

    this.addStep(task, {
      stepIndex: 0,
      thought: `为订单 ${orderId} 协调物流，目的国：${destinationCountry}`,
    });

    try {
      task.status = 'running';
      const userContent =
        `订单 ID: ${orderId}\n` +
        `目的国: ${destinationCountry}\n` +
        `出货仓库: ${warehouseId}\n` +
        `SKU 清单: ${JSON.stringify(skuList)}\n\n` +
        `请查询可用物流渠道（过滤目的国），选择最优渠道，创建出库单，然后推送到 WMS。`;

      const messages = this.buildMessages(userContent);
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
   * 快捷方法：直接创建出库单（不经过 LLM，用于渠道已知的确定性场景）
   */
  async createOutOrderDirect(params: {
    orderId: number;
    channelId: number;
    warehouseId: number;
    skuList: Array<{ skuCode: string; qty: number }>;
  }): Promise<OutOrder> {
    const outOrder = await logisticsApi.createOutOrder(params);
    logger.info({ outOrderId: outOrder.outOrderId }, '出库单创建成功');
    await logisticsApi.pushToWms(outOrder.outOrderId);
    return outOrder;
  }
}

export const logisticsAgent = new LogisticsAgent();
