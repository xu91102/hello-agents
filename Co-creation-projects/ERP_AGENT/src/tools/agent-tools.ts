import { inventoryApi } from '../api/inventory-api';
import { logisticsAgent } from '../agents/logistics-agent';
import { purchaseAgent } from '../agents/purchase-agent';
import { supplierAgent } from '../agents/supplier-agent';
import { fulfillmentWorkflow } from '../core/fulfillment-workflow';
import { orchestrator } from '../core/orchestrator';
import { approvalTaskStore } from '../core/approval-task-store';
import { logger } from '../logger';
import type {
  InventoryInfo,
  PurchaseApply,
  PurchaseApprovalRequest,
  ToolDef,
} from '../core/types';

type InventoryQueryKind = 'sku' | 'productName';
type InventoryAlertLevel = 'none' | 'ordinary' | 'high_risk';

interface InventoryQuery {
  kind: InventoryQueryKind;
  value: string;
}

function readStringArray(args: Record<string, unknown>, keys: string[]): string[] {
  const values: string[] = [];
  keys.forEach((key) => {
    const raw = args[key];
    if (typeof raw === 'string' && raw.trim()) {
      values.push(raw.trim());
      return;
    }

    if (Array.isArray(raw)) {
      raw.forEach((item) => {
        if (typeof item === 'string' && item.trim()) {
          values.push(item.trim());
        }
      });
    }
  });

  return Array.from(new Set(values));
}

function looksLikeSku(value: string): boolean {
  const normalizedValue = value.trim();
  return (
    normalizedValue.length >= 4 &&
    /^[A-Za-z0-9._-]+$/.test(normalizedValue) &&
    /[A-Za-z]/.test(normalizedValue) &&
    /\d/.test(normalizedValue)
  );
}

function dedupeInventoryQueries(queries: InventoryQuery[]): InventoryQuery[] {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = `${query.kind}:${query.value.toUpperCase()}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

type NewPurchaseApprovalRequest = Omit<PurchaseApprovalRequest, 'taskId' | 'status' | 'expiresAt'>;

function buildPurchaseApprovalRequest(apply: PurchaseApply): NewPurchaseApprovalRequest | null {
  if (!apply.applyCreated || !apply.applyId) {
    return null;
  }

  return {
    approvalId: `purchase-apply-${apply.applyId}-${apply.applySkuId ?? 0}`,
    kind: 'purchase_apply_full_approval',
    applyId: apply.applyId,
    applyNumber: apply.applyNumber,
    applySkuId: apply.applySkuId,
    skuCode: apply.skuCode,
    goodsName: apply.goodsName,
    skuId: apply.skuId,
    skuSpecName: apply.skuSpecName,
    qty: apply.approvalQuantity ?? apply.qty,
    supplierId: apply.supplierId,
    supplierName: apply.supplierName,
    estimatedArrivalDate: apply.estimatedArrivalDate,
    warehouseId: apply.warehouseId,
    warehouseName: apply.warehouseName,
    overseasWarehouseId: apply.overseasWarehouseId,
    overseasWarehouseName: apply.overseasWarehouseName,
    virtualWarehouseId: apply.virtualWarehouseId,
    virtualWarehouseName: apply.virtualWarehouseName,
    operationTeamId: apply.operationTeamId,
    operationTeamName: apply.operationTeamName,
    purchaseUrl: apply.purchaseUrl,
    priceWithTax: apply.priceWithTax,
    priceWithoutTax: apply.priceWithoutTax,
    taxRate: apply.taxRate,
    subtotalWithTax: apply.subtotalWithTax,
    subtotalWithoutTax: apply.subtotalWithoutTax,
    isTax: apply.isTax,
    purchasePrice: apply.purchasePrice,
    isBillingData: apply.isBillingData,
    billingDataType: apply.billingDataType,
    billingEntity: apply.billingEntity,
    actions: ['first_audit', 'second_audit', 'gen_purchase_order'],
  };
}

function buildInventoryQueries(args: Record<string, unknown>): InventoryQuery[] {
  const skuCodes = readStringArray(args, ['sku_codes', 'sku_code', 'sku', 'skus']);
  const productNames = readStringArray(args, [
    'product_names',
    'product_name',
    'productName',
    'goods_names',
    'goods_name',
    'goodsName',
    'name',
    'keyword',
    'query',
  ]);

  return dedupeInventoryQueries([
    ...skuCodes.map((value) => ({ kind: 'sku' as const, value })),
    ...productNames.map((value) => ({
      kind: looksLikeSku(value) ? 'sku' as const : 'productName' as const,
      value,
    })),
  ]);
}

function getStockAlertLevel(item: InventoryInfo): InventoryAlertLevel {
  if (item.statusText?.includes('高危')) {
    return 'high_risk';
  }

  if (item.statusText?.includes('普通')) {
    return 'ordinary';
  }

  if (item.highWarnNum != null && item.totalQty < item.highWarnNum) {
    return 'high_risk';
  }

  if (item.ordinaryWarnNum != null && item.totalQty < item.ordinaryWarnNum) {
    return 'ordinary';
  }

  return 'none';
}

function getAlertDeficitQty(item: InventoryInfo): number {
  const alertLevel = getStockAlertLevel(item);
  if (alertLevel === 'high_risk' && item.highWarnNum != null) {
    return Math.max(0, item.highWarnNum - item.totalQty);
  }

  if (alertLevel === 'ordinary' && item.ordinaryWarnNum != null) {
    return Math.max(0, item.ordinaryWarnNum - item.totalQty);
  }

  return 0;
}

function getHighestAlertLevel(levels: InventoryAlertLevel[]): InventoryAlertLevel {
  if (levels.includes('high_risk')) {
    return 'high_risk';
  }

  if (levels.includes('ordinary')) {
    return 'ordinary';
  }

  return 'none';
}

function groupStockBySku(rows: InventoryInfo[]) {
  const groups = new Map<string, InventoryInfo[]>();
  rows.forEach((row) => {
    const key = row.skuCode || String(row.skuId ?? '');
    if (!key) return;

    const items = groups.get(key) ?? [];
    items.push(row);
    groups.set(key, items);
  });

  return Array.from(groups.entries()).map(([skuCode, warehouses]) => {
    const first = warehouses[0];
    const alertLevel = getHighestAlertLevel(warehouses.map((item) => getStockAlertLevel(item)));
    const alertWarehouse =
      warehouses.find((item) => getStockAlertLevel(item) === 'high_risk') ??
      warehouses.find((item) => getStockAlertLevel(item) === 'ordinary');

    return {
      skuCode,
      skuId: first.skuId,
      skuName: first.skuName,
      productName: first.productName,
      itemNo: first.itemNo,
      alertLevel,
      procurementRequired: alertLevel !== 'none',
      alertDeficitQty: warehouses.reduce((sum, item) => sum + getAlertDeficitQty(item), 0),
      alertWarehouse: alertWarehouse
        ? {
            warehouseId: alertWarehouse.warehouseId,
            warehouseName: alertWarehouse.warehouseName,
            warehouseClassification: alertWarehouse.warehouseClassification,
            operationTeamId: alertWarehouse.operationTeamId,
            status: alertWarehouse.status,
            statusText: alertWarehouse.statusText,
            alertLevel: getStockAlertLevel(alertWarehouse),
            highWarnNum: alertWarehouse.highWarnNum,
            ordinaryWarnNum: alertWarehouse.ordinaryWarnNum,
            totalQty: alertWarehouse.totalQty,
            availableQty: alertWarehouse.availableQty,
          }
        : undefined,
      availableQty: warehouses.reduce((sum, item) => sum + item.availableQty, 0),
      totalQty: warehouses.reduce((sum, item) => sum + item.totalQty, 0),
      lockedQty: warehouses.reduce((sum, item) => sum + item.lockedQty, 0),
      warehouses: warehouses.map((item) => ({
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        warehouseClassification: item.warehouseClassification,
        operationTeamId: item.operationTeamId,
        status: item.status,
        statusText: item.statusText,
        alertLevel: getStockAlertLevel(item),
        highWarnNum: item.highWarnNum,
        ordinaryWarnNum: item.ordinaryWarnNum,
        safetyStock: item.safetyStock,
        availableQty: item.availableQty,
        totalQty: item.totalQty,
        lockedQty: item.lockedQty,
      })),
    };
  });
}

export function buildOrchestratorTools(): ToolDef[] {
  return [
    {
      name: 'query_inventory',
      description: '查询一个或多个 SKU 或商品名称在各仓库的实时库存。安排发货前必须先调用。',
      parameters: {
        type: 'object',
        properties: {
          sku_codes: {
            type: 'array',
            description: '要查询的 SKU 列表',
            items: { type: 'string', description: 'SKU 编码' },
          },
          sku: {
            type: 'string',
            description: '单个 SKU 编码或货号，例如 WGXB02000201、KC10737483。模型只有一个 SKU 时也可以使用该字段。',
          },
          product_names: {
            type: 'array',
            description: '要查询的商品名称列表，支持模糊查询',
            items: { type: 'string', description: '商品名称' },
          },
          product_name: {
            type: 'string',
            description: '单个自然语言商品名称，支持模糊查询。不要把 SKU 编码或货号放到这里。',
          },
          required_qtys: {
            type: 'object',
            description: '每个 SKU 所需数量，格式如 { "SKU-001": 10 }',
          },
        },
      },
      execute: async (args) => {
        const queries = buildInventoryQueries(args);
        const requiredQtys = args['required_qtys'] as Record<string, number> | undefined;

        if (queries.length === 0) {
          return {
            dataSource: 'erp',
            decisions: [],
            message: '缺少查询条件，请提供 SKU 编码或商品名称。',
          };
        }

        const decisions = await Promise.all(
          queries.map(async (query) => {
            let warehouses =
              query.kind === 'sku'
                ? await inventoryApi.getStockBySku(query.value)
                : await inventoryApi.getStockByProductName(query.value);

            if (query.kind === 'sku' && warehouses.length === 0) {
              warehouses = await inventoryApi.getStockByProductName(query.value);
            }

            const matches = groupStockBySku(warehouses);
            const availableQty = matches.reduce((sum, item) => sum + item.availableQty, 0);
            const alertLevel = getHighestAlertLevel(matches.map((item) => item.alertLevel));
            const requiredQty = requiredQtys?.[query.value] ?? 1;
            const stockDeficitQty = Math.max(0, requiredQty - availableQty);
            const alertDeficitQty = matches.reduce((sum, item) => sum + item.alertDeficitQty, 0);
            const procurementRequired = stockDeficitQty > 0 || alertLevel !== 'none';
            const deficitQty = procurementRequired
              ? Math.max(1, stockDeficitQty, alertDeficitQty)
              : 0;
            const alertMatch = matches.find((item) => item.alertWarehouse);
            const status = availableQty === 0
              ? 'empty'
              : availableQty >= requiredQty
                ? 'sufficient'
                : 'insufficient';

            return {
              query: query.value,
              queryType: query.kind,
              requiredQty,
              deficitQty,
              availableQty,
              status,
              alertLevel,
              procurementRequired,
              triggerWarehouse: alertMatch?.alertWarehouse,
              matches,
            };
          }),
        );

        return { dataSource: 'erp', decisions };
      },
    },
    {
      name: 'coordinate_logistics',
      description: '在库存已确认的前提下，协调物流或出库动作。',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: '订单 ID' },
          destination_country: { type: 'string', description: '目的国家代码' },
          warehouse_id: { type: 'number', description: '出货仓库 ID' },
          sku_list: {
            type: 'array',
            description: 'SKU 列表，每项包含 skuCode 与 qty',
            items: { type: 'object', description: '出库 SKU' },
          },
        },
        required: ['order_id', 'destination_country', 'warehouse_id', 'sku_list'],
      },
      execute: async (args) => {
        logger.info({ orderId: args['order_id'] }, 'Orchestrator 调用物流 Agent');
        const task = {
          taskId: '',
          type: 'order_process' as const,
          input: {
            orderId: args['order_id'],
            destinationCountry: args['destination_country'],
            warehouseId: args['warehouse_id'],
            skuList: args['sku_list'],
          },
          status: 'pending' as const,
          steps: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const result = await logisticsAgent.execute(task);
        return { status: result.status, summary: result.result };
      },
    },
    {
      name: 'trigger_purchase',
      description: '对库存不足的 SKU 生成采购补货动作，并选择推荐供应商。',
      parameters: {
        type: 'object',
        properties: {
          sku_code: { type: 'string', description: 'SKU 编码' },
          deficit_qty: { type: 'number', description: '缺口数量' },
          is_urgent: { type: 'boolean', description: '是否紧急' },
          warehouse_id: { type: 'number', description: '国内中转仓 ID；如果只有触发预警的库存仓，请改用 stock_warehouse_id' },
          warehouse_name: { type: 'string', description: '国内中转仓名称' },
          stock_warehouse_id: { type: 'number', description: 'query_inventory 返回的触发预警库存仓 ID' },
          stock_warehouse_name: { type: 'string', description: 'query_inventory 返回的触发预警库存仓名称' },
          stock_warehouse_classification: {
            type: 'number',
            description: '触发预警库存仓分类：1 国内中转仓，2 海外仓，3 虚拟仓',
          },
          operation_team_id: { type: 'number', description: 'query_inventory 返回的运营团队 ID' },
        },
        required: ['sku_code', 'deficit_qty'],
      },
      execute: async (args) => {
        const stockWarehouseId = args['stock_warehouse_id'] as number | undefined;
        const stockWarehouseName = args['stock_warehouse_name'] as string | undefined;
        const stockWarehouseClassification = args['stock_warehouse_classification'] as number | undefined;
        const warehouseId = args['warehouse_id'] as number | undefined;
        const warehouseName = args['warehouse_name'] as string | undefined;
        const apply = await purchaseAgent.createApplyDirect({
          skuCode: args['sku_code'] as string,
          deficitQty: args['deficit_qty'] as number,
          isUrgent: (args['is_urgent'] as boolean) ?? false,
          warehouseId: stockWarehouseClassification === 1 ? stockWarehouseId ?? warehouseId : warehouseId,
          warehouseName: stockWarehouseClassification === 1 ? stockWarehouseName ?? warehouseName : warehouseName,
          overseasWarehouseId: stockWarehouseClassification === 2 ? stockWarehouseId : undefined,
          overseasWarehouseName: stockWarehouseClassification === 2 ? stockWarehouseName : undefined,
          virtualWarehouseId: stockWarehouseClassification === 3 ? stockWarehouseId : undefined,
          virtualWarehouseName: stockWarehouseClassification === 3 ? stockWarehouseName : undefined,
          operationTeamId: args['operation_team_id'] as number | undefined,
        });

        const failureReason = apply.applyCreated ? undefined : apply.remark;
        const newApprovalRequest = buildPurchaseApprovalRequest(apply);
        const approvalTask = newApprovalRequest
          ? await approvalTaskStore.createPurchaseApprovalTask({ request: newApprovalRequest })
          : null;
        const approvalRequest = approvalTask?.request ?? null;

        return {
          applyId: apply.applyId,
          applyNumber: apply.applyNumber,
          applySkuId: apply.applySkuId,
          applyCreated: apply.applyCreated ?? false,
          status: apply.status,
          supplierId: apply.supplierId,
          supplierName: apply.supplierName,
          qty: apply.qty,
          estimatedArrivalDate: apply.estimatedArrivalDate,
          approvalTask,
          approvalRequest,
          workflowStatus: approvalTask ? 'waiting_for_approval' : apply.status,
          failureReason,
          summary: apply.applyCreated
            ? `已创建采购动作，供应商 ${apply.supplierName}，预计到货 ${apply.estimatedArrivalDate}。当前等待用户授权后继续执行一审、二审和生成采购单`
            : `已选择供应商 ${apply.supplierName}，但 ERP 未自动建单，原因：${failureReason ?? 'ERP 未返回具体原因'}。需采购人工跟进`,
        };
      },
    },
    {
      name: 'notify_supplier',
      description: '向供应商发送补货或催货通知，若接口不可用则返回人工跟进建议。',
      parameters: {
        type: 'object',
        properties: {
          supplier_id: { type: 'number', description: '供应商 ID' },
          purchase_apply_id: { type: 'number', description: '采购申请单 ID' },
          sku_code: { type: 'string', description: 'SKU 编码' },
          is_urgent: { type: 'boolean', description: '是否紧急催货' },
        },
        required: ['supplier_id', 'sku_code'],
      },
      execute: async (args) => {
        const result = await supplierAgent.notifySupplierDirect({
          supplierId: args['supplier_id'] as number,
          purchaseApplyId: args['purchase_apply_id'] as number | undefined,
          skuCode: args['sku_code'] as string,
          isUrgent: (args['is_urgent'] as boolean) ?? false,
        });
        return result;
      },
    },
    {
      name: 'execute_fulfillment_flow',
      description: '执行固定履约流程：先叫仓库发货，库存不足再转采购，再协同供应商。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '履约项列表，每项格式 { skuCode: string, requiredQty: number }',
            items: { type: 'object', description: '履约项' },
          },
          auto_notify_supplier: {
            type: 'boolean',
            description: '库存不足后是否自动协同供应商',
          },
        },
        required: ['items'],
      },
      execute: async (args) => {
        return fulfillmentWorkflow.execute({
          items: args['items'] as Array<{ skuCode: string; requiredQty: number }>,
          autoNotifySupplier: (args['auto_notify_supplier'] as boolean) ?? true,
        });
      },
    },
  ];
}

export function initializeAgents(): void {
  const tools = buildOrchestratorTools();
  orchestrator.registerAgentTools(tools);
  logger.info({ toolCount: tools.length }, 'Agent 工具已注册到 Orchestrator');
}
