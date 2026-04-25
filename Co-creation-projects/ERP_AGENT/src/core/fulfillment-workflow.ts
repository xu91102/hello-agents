import { inventoryApi } from '../api/inventory-api';
import { purchaseAgent } from '../agents/purchase-agent';
import { supplierAgent } from '../agents/supplier-agent';
import { logger } from '../logger';
import type {
  FulfillmentAllocation,
  FulfillmentLineInput,
  FulfillmentLineResult,
} from './types';

interface FulfillmentWorkflowInput {
  items: FulfillmentLineInput[];
  autoNotifySupplier?: boolean;
}

interface FulfillmentWorkflowResult {
  lines: FulfillmentLineResult[];
  summary: string;
}

function allocateWarehouses(
  stocks: Array<{
    warehouseId: number;
    warehouseName: string;
    availableQty: number;
  }>,
  requiredQty: number,
): { allocations: FulfillmentAllocation[]; shippedQty: number } {
  let remaining = requiredQty;
  const allocations: FulfillmentAllocation[] = [];

  const candidates = [...stocks]
    .filter((item) => item.availableQty > 0)
    .sort((a, b) => b.availableQty - a.availableQty);

  for (const stock of candidates) {
    if (remaining <= 0) {
      break;
    }

    const qty = Math.min(stock.availableQty, remaining);
    allocations.push({
      warehouseId: stock.warehouseId,
      warehouseName: stock.warehouseName,
      qty,
    });
    remaining -= qty;
  }

  return {
    allocations,
    shippedQty: requiredQty - remaining,
  };
}

function buildSummary(lines: FulfillmentLineResult[]): string {
  return lines
    .map((line) => {
      const allocationText =
        line.allocations.length > 0
          ? `仓库发货 ${line.allocations.map((item) => `${item.warehouseName} ${item.qty}`).join('，')}`
          : '无可发货库存';
      const purchaseText = line.purchase
        ? line.purchase.applyCreated
          ? `已触发采购补货，供应商 ${line.purchase.supplierName}`
          : `已定位供应商 ${line.purchase.supplierName}，待采购人工跟进`
        : '无需采购';
      const supplierText = line.supplierNotification
        ? line.supplierNotification.manualFollowUpRequired
          ? '供应商需人工催办'
          : '供应商已通知'
        : '未通知供应商';

      return `${line.skuCode}: ${allocationText}；缺口 ${line.shortageQty}；${purchaseText}；${supplierText}`;
    })
    .join('\n');
}

export const fulfillmentWorkflow = {
  async execute(input: FulfillmentWorkflowInput): Promise<FulfillmentWorkflowResult> {
    const lines: FulfillmentLineResult[] = [];

    for (const item of input.items) {
      const stocks = await inventoryApi.getStockBySku(item.skuCode);
      const availableQty = stocks.reduce((sum, stock) => sum + stock.availableQty, 0);
      const { allocations, shippedQty } = allocateWarehouses(stocks, item.requiredQty);
      const shortageQty = Math.max(0, item.requiredQty - shippedQty);

      let purchase: FulfillmentLineResult['purchase'];
      let supplierNotification: FulfillmentLineResult['supplierNotification'];

      if (shortageQty > 0) {
        purchase = await purchaseAgent.createApplyDirect({
          skuCode: item.skuCode,
          deficitQty: shortageQty,
          isUrgent: shippedQty === 0,
        });

        if (input.autoNotifySupplier !== false) {
          supplierNotification = await supplierAgent.notifySupplierDirect({
            supplierId: purchase.supplierId,
            skuCode: item.skuCode,
            isUrgent: shippedQty === 0,
            purchaseApplyId: purchase.applyId,
          });
        }
      }

      const status =
        shortageQty === 0
          ? 'ready_to_ship'
          : shippedQty > 0
            ? 'partial_purchase_required'
            : 'purchase_required';

      lines.push({
        skuCode: item.skuCode,
        requiredQty: item.requiredQty,
        availableQty,
        shippedQty,
        shortageQty,
        status,
        allocations,
        purchase,
        supplierNotification,
      });
    }

    logger.info(
      {
        lineCount: lines.length,
        purchaseCount: lines.filter((item) => item.purchase != null).length,
      },
      '履约工作流执行完成',
    );

    return {
      lines,
      summary: buildSummary(lines),
    };
  },
};
