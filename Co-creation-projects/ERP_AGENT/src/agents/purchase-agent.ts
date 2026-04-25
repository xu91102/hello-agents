import { AgentBase } from '../core/agent-base';
import { LlmClient } from '../core/llm-client';
import { purchaseApi } from '../api/purchase-api';
import { logger } from '../logger';
import type {
  AgentTask,
  AgentResult,
  ToolDef,
  PurchaseApply,
  SupplierCandidate,
} from '../core/types';

interface PurchaseSelection {
  supplier: SupplierCandidate;
  purchaseQty: number;
  estimatedArrivalDate: string;
}

function buildArrivalDate(leadDays: number): string {
  return new Date(Date.now() + leadDays * 86400_000).toISOString().slice(0, 10);
}

function calculatePurchaseQty(deficitQty: number): number {
  return Math.max(1, Math.ceil(deficitQty * 1.2));
}

function sortSuppliers(suppliers: SupplierCandidate[], isUrgent: boolean): SupplierCandidate[] {
  if (isUrgent) {
    return [...suppliers].sort((a, b) => a.leadDays - b.leadDays || a.unitPrice - b.unitPrice);
  }

  return [...suppliers].sort((a, b) => {
    if (b.rating !== a.rating) {
      return b.rating - a.rating;
    }
    if (a.unitPrice !== b.unitPrice) {
      return a.unitPrice - b.unitPrice;
    }
    return a.leadDays - b.leadDays;
  });
}

export class PurchaseAgent extends AgentBase {
  readonly name = 'PurchaseAgent';
  readonly systemPrompt = `你是 QQPGERP 采购补货专家。
你的任务是为缺货 SKU 生成补货动作，优先基于真实 ERP 商品与供应商数据。
你可以协助解释采购建议，但库存缺口、补货数量和供应商候选必须以工具数据为准。`;

  private llmClient: LlmClient;

  readonly tools: ToolDef[] = [
    {
      name: 'get_sku_suppliers',
      description: '查询 SKU 的可用供应商列表，包含价格、交期与默认供应商标记',
      parameters: {
        type: 'object',
        properties: {
          sku_code: { type: 'string', description: 'SKU 编码' },
        },
        required: ['sku_code'],
      },
      execute: async (args) => {
        const skuCode = args['sku_code'] as string;
        const suppliers = await purchaseApi.getSuppliersBySku(skuCode);
        return { skuCode, supplierCount: suppliers.length, suppliers };
      },
    },
    {
      name: 'create_purchase_apply',
      description: '为指定 SKU 创建采购申请，若 ERP 创建失败则返回人工跟进建议',
      parameters: {
        type: 'object',
        properties: {
          sku_code: { type: 'string', description: 'SKU 编码' },
          qty: { type: 'number', description: '采购数量' },
          supplier_id: { type: 'number', description: '供应商 ID' },
          warehouse_id: { type: 'number', description: '国内中转仓 ID' },
          warehouse_name: { type: 'string', description: '国内中转仓名称' },
          overseas_warehouse_id: { type: 'number', description: '海外仓 ID' },
          overseas_warehouse_name: { type: 'string', description: '海外仓名称' },
          virtual_warehouse_id: { type: 'number', description: '虚拟仓 ID' },
          virtual_warehouse_name: { type: 'string', description: '虚拟仓名称' },
          operation_team_id: { type: 'number', description: '运营团队 ID' },
          estimated_arrival_date: {
            type: 'string',
            description: '预计到货日期，格式 YYYY-MM-DD',
          },
          is_urgent: { type: 'boolean', description: '是否紧急采购' },
          remark: { type: 'string', description: '备注' },
        },
        required: ['sku_code', 'qty', 'supplier_id', 'estimated_arrival_date'],
      },
      execute: async (args) => {
        const skuCode = args['sku_code'] as string;
        const suppliers = await purchaseApi.getSuppliersBySku(skuCode);
        const supplierId = args['supplier_id'] as number;
        const supplier = suppliers.find((item) => item.supplierId === supplierId);

        if (!supplier) {
          throw new Error(`SKU ${skuCode} 未找到供应商 ${supplierId}`);
        }

        const apply = await purchaseApi.createPurchaseApply({
          skuCode,
          qty: args['qty'] as number,
          supplier,
          estimatedArrivalDate: args['estimated_arrival_date'] as string,
          isUrgent: (args['is_urgent'] as boolean) ?? false,
          remark: args['remark'] as string | undefined,
          warehouseId: args['warehouse_id'] as number | undefined,
          warehouseName: args['warehouse_name'] as string | undefined,
          overseasWarehouseId: args['overseas_warehouse_id'] as number | undefined,
          overseasWarehouseName: args['overseas_warehouse_name'] as string | undefined,
          virtualWarehouseId: args['virtual_warehouse_id'] as number | undefined,
          virtualWarehouseName: args['virtual_warehouse_name'] as string | undefined,
          operationTeamId: args['operation_team_id'] as number | undefined,
        });

        const failureReason = apply.applyCreated ? undefined : apply.remark;
        return {
          applyCreated: apply.applyCreated ?? false,
          status: apply.status,
          supplierName: apply.supplierName,
          estimatedArrivalDate: apply.estimatedArrivalDate,
          failureReason,
          message: apply.applyCreated
            ? `采购申请已创建，供应商：${apply.supplierName}，预计到货：${apply.estimatedArrivalDate}`
            : `采购申请未自动落单，原因：${failureReason ?? 'ERP 未返回具体原因'}。建议采购跟进供应商：${apply.supplierName}`,
        };
      },
    },
  ];

  constructor() {
    super();
    this.llmClient = new LlmClient();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const { skuCode, deficitQty, isUrgent } = task.input as {
      skuCode: string;
      deficitQty: number;
      isUrgent?: boolean;
    };

    this.addStep(task, {
      stepIndex: 0,
      thought: `为 ${skuCode} 生成采购补货动作，缺口 ${deficitQty}`,
    });

    try {
      task.status = 'running';
      const purchase = await this.createApplyDirect({ skuCode, deficitQty, isUrgent });
      const result = purchase.applyCreated
        ? `已为 ${skuCode} 生成采购申请，供应商 ${purchase.supplierName}，预计到货 ${purchase.estimatedArrivalDate}`
        : `已为 ${skuCode} 选择供应商 ${purchase.supplierName}，但 ERP 未自动建单，原因：${purchase.remark ?? 'ERP 未返回具体原因'}。需采购人工跟进`;
      return this.completeTask(task, result);
    } catch (err) {
      return this.failTask(task, err);
    }
  }

  async selectSupplierDirect(params: {
    skuCode: string;
    deficitQty: number;
    isUrgent?: boolean;
  }): Promise<PurchaseSelection> {
    const suppliers = await purchaseApi.getSuppliersBySku(params.skuCode);
    if (suppliers.length === 0) {
      throw new Error(`SKU ${params.skuCode} 没有可用供应商`);
    }

    const sorted = sortSuppliers(suppliers, params.isUrgent ?? false);
    const selected = sorted[0];
    if (!selected) {
      throw new Error(`SKU ${params.skuCode} 供应商筛选失败`);
    }

    const purchaseQty = calculatePurchaseQty(params.deficitQty);
    const estimatedArrivalDate = buildArrivalDate(selected.leadDays);

    logger.info(
      {
        skuCode: params.skuCode,
        supplierId: selected.supplierId,
        purchaseQty,
        isUrgent: params.isUrgent ?? false,
      },
      '采购 Agent 已选择供应商',
    );

    return {
      supplier: selected,
      purchaseQty,
      estimatedArrivalDate,
    };
  }

  async createApplyDirect(params: {
    skuCode: string;
    deficitQty: number;
    isUrgent?: boolean;
    warehouseId?: number;
    warehouseName?: string;
    overseasWarehouseId?: number;
    overseasWarehouseName?: string;
    virtualWarehouseId?: number;
    virtualWarehouseName?: string;
    operationTeamId?: number;
  }): Promise<PurchaseApply> {
    const selection = await this.selectSupplierDirect(params);

    try {
      return await purchaseApi.createPurchaseApply({
        skuCode: params.skuCode,
        qty: selection.purchaseQty,
        supplier: selection.supplier,
        estimatedArrivalDate: selection.estimatedArrivalDate,
        isUrgent: params.isUrgent,
        warehouseId: params.warehouseId,
        warehouseName: params.warehouseName,
        overseasWarehouseId: params.overseasWarehouseId,
        overseasWarehouseName: params.overseasWarehouseName,
        virtualWarehouseId: params.virtualWarehouseId,
        virtualWarehouseName: params.virtualWarehouseName,
        operationTeamId: params.operationTeamId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ skuCode: params.skuCode, error: message }, '采购申请自动创建失败，转人工跟进');
      return {
        skuCode: params.skuCode,
        qty: selection.purchaseQty,
        supplierId: selection.supplier.supplierId,
        supplierName: selection.supplier.supplierName,
        estimatedArrivalDate: selection.estimatedArrivalDate,
        status: 'pending_manual',
        applyCreated: false,
        remark: message,
      };
    }
  }
}

export const purchaseAgent = new PurchaseAgent();
