import { AgentBase } from '../core/agent-base';
import { LlmClient } from '../core/llm-client';
import { supplierApi } from '../api/supplier-api';
import { logger } from '../logger';
import type {
  AgentTask,
  AgentResult,
  ToolDef,
  SupplierNotificationResult,
} from '../core/types';

interface SupplierDetail {
  supplierId: number;
  supplierName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

function buildManualMessage(detail: SupplierDetail, isUrgent: boolean): string {
  const urgencyText = isUrgent ? '紧急催交' : '补货跟进';
  const contact = [detail.contactName, detail.contactPhone, detail.contactEmail].filter(Boolean).join(' / ');
  return `${urgencyText}需人工跟进，供应商：${detail.supplierName}${contact ? `，联系方式：${contact}` : ''}`;
}

export class SupplierAgent extends AgentBase {
  readonly name = 'SupplierAgent';
  readonly systemPrompt = `你是 QQPGERP 供应商协同助手。
你的职责是根据已选供应商生成催货动作，并优先返回可执行的联系方式与跟进结论。`;

  private llmClient: LlmClient;

  readonly tools: ToolDef[] = [
    {
      name: 'get_supplier_info',
      description: '查询供应商基础信息和联系方式',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: { type: 'number', description: '供应商 ID' },
        },
        required: ['supplier_id'],
      },
      execute: async (args) => {
        return supplierApi.getSupplierDetail(args['supplier_id'] as number);
      },
    },
    {
      name: 'send_supplier_notification',
      description: '向供应商发送补货或催货通知，若接口不可用则回退为人工跟进',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: { type: 'number', description: '供应商 ID' },
          notification_type: {
            type: 'string',
            enum: ['replenishment', 'urgent', 'reminder'],
            description: '通知类型',
          },
          purchase_apply_id: {
            type: 'number',
            description: '采购申请单 ID，可选',
          },
          message: { type: 'string', description: '通知内容' },
          expected_reply_date: {
            type: 'string',
            description: '期望回复日期，格式 YYYY-MM-DD',
          },
        },
        required: ['supplier_id', 'notification_type', 'message'],
      },
      execute: async (args) => {
        const detail = await supplierApi.getSupplierDetail(args['supplier_id'] as number);

        try {
          const result = await supplierApi.sendNotification({
            supplierId: args['supplier_id'] as number,
            type: args['notification_type'] as 'replenishment' | 'urgent' | 'reminder',
            purchaseApplyId: args['purchase_apply_id'] as number | undefined,
            message: args['message'] as string,
            expectedReplyDate: args['expected_reply_date'] as string | undefined,
          });
          return {
            supplierName: detail.supplierName,
            notifyId: result.notifyId,
            sentAt: result.sentAt,
            manualFollowUpRequired: false,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            supplierName: detail.supplierName,
            manualFollowUpRequired: true,
            message: `${buildManualMessage(detail, args['notification_type'] === 'urgent')}；原因：${errorMsg}`,
          };
        }
      },
    },
  ];

  constructor() {
    super();
    this.llmClient = new LlmClient();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const { supplierId, purchaseApplyId, isUrgent, skuCode } = task.input as {
      supplierId: number;
      purchaseApplyId?: number;
      isUrgent?: boolean;
      skuCode: string;
    };

    try {
      task.status = 'running';
      const result = await this.notifySupplierDirect({
        supplierId,
        purchaseApplyId,
        skuCode,
        isUrgent,
      });
      return this.completeTask(task, result.message);
    } catch (err) {
      return this.failTask(task, err);
    }
  }

  async notifySupplierDirect(params: {
    supplierId: number;
    purchaseApplyId?: number;
    skuCode: string;
    isUrgent?: boolean;
  }): Promise<SupplierNotificationResult> {
    const detail = await supplierApi.getSupplierDetail(params.supplierId);
    const message = params.isUrgent
      ? `SKU ${params.skuCode} 当前缺货，请优先确认补货与发货安排。`
      : `SKU ${params.skuCode} 已触发补货，请确认交期安排。`;

    try {
      const result = await supplierApi.sendNotification({
        supplierId: params.supplierId,
        type: params.isUrgent ? 'urgent' : 'replenishment',
        purchaseApplyId: params.purchaseApplyId,
        message,
      });

      return {
        supplierId: params.supplierId,
        supplierName: detail.supplierName,
        notified: true,
        manualFollowUpRequired: false,
        notifyId: result.notifyId,
        sentAt: result.sentAt,
        contactName: detail.contactName,
        contactPhone: detail.contactPhone,
        contactEmail: detail.contactEmail,
        message: `已向供应商 ${detail.supplierName} 发出通知`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn({ supplierId: params.supplierId, error: errorMsg }, '供应商通知接口不可用，转人工跟进');
      return {
        supplierId: params.supplierId,
        supplierName: detail.supplierName,
        notified: false,
        manualFollowUpRequired: true,
        contactName: detail.contactName,
        contactPhone: detail.contactPhone,
        contactEmail: detail.contactEmail,
        message: `${buildManualMessage(detail, params.isUrgent ?? false)}；原因：${errorMsg}`,
      };
    }
  }
}

export const supplierAgent = new SupplierAgent();
