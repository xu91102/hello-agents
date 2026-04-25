import { purchaseApi } from '../api/purchase-api';
import { approvalTaskStore } from './approval-task-store';
import type {
  AgentResult,
  ApprovalTask,
  PurchaseApprovalRequest,
} from './types';

interface ApprovePurchaseWorkflowInput {
  approvalId: string;
  approvedQty?: number;
  operatorId?: string;
  operatorName?: string;
}

function getFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

function buildAuditSkuInputs(detail: Record<string, unknown>, request: PurchaseApprovalRequest) {
  const skuList = readArray(detail['PurchaseApplySkuList']);
  const targetSku =
    skuList.find((item) => getFiniteNumber(item['Id']) === request.applySkuId) ||
    skuList.find((item) => getFiniteNumber(item['SkuId']) === request.skuId) ||
    skuList[0] ||
    {};
  const approvalQuantity =
    request.qty ||
    getFiniteNumber(targetSku['ApprovalQuantity']) ||
    getFiniteNumber(targetSku['ApplyQuantity']) ||
    0;
  const priceWithTax = getFiniteNumber(targetSku['PriceWithTax']) ?? request.priceWithTax;
  const priceWithoutTax = getFiniteNumber(targetSku['PriceWithoutTax']) ?? request.priceWithoutTax;
  const taxRate = getFiniteNumber(targetSku['TaxRate']) ?? request.taxRate;
  const subtotalWithTax =
    getFiniteNumber(targetSku['SubtotalWithTax']) ??
    (priceWithTax ? Number((priceWithTax * approvalQuantity).toFixed(4)) : undefined);
  const subtotalWithoutTax =
    getFiniteNumber(targetSku['SubtotalWithoutTax']) ??
    (priceWithoutTax ? Number((priceWithoutTax * approvalQuantity).toFixed(4)) : undefined);

  return [
    {
      ...targetSku,
      Id: getFiniteNumber(targetSku['Id']) ?? request.applySkuId,
      SkuId: getFiniteNumber(targetSku['SkuId']) ?? request.skuId,
      SupplierId: getFiniteNumber(targetSku['SupplierId']) ?? request.supplierId,
      SupplierName: getString(targetSku['SupplierName']) || request.supplierName,
      PurchaseUrl: getString(targetSku['PurchaseUrl']) || request.purchaseUrl || '',
      ApprovalQuantity: approvalQuantity,
      WarehouseId: getFiniteNumber(targetSku['WarehouseId']) ?? request.warehouseId,
      WarehouseName: getString(targetSku['WarehouseName']) || request.warehouseName || '',
      OverseasWarehouseId: getFiniteNumber(targetSku['OverseasWarehouseId']) ?? request.overseasWarehouseId,
      OverseasWarehouseName: getString(targetSku['OverseasWarehouseName']) || request.overseasWarehouseName || '',
      VirtualWarehouseId: getFiniteNumber(targetSku['VirtualWarehouseId']) ?? request.virtualWarehouseId,
      VirtualWarehouseName: getString(targetSku['VirtualWarehouseName']) || request.virtualWarehouseName || '',
      OperationTeamId: getFiniteNumber(targetSku['OperationTeamId']) ?? request.operationTeamId,
      OperationTeamName: getString(targetSku['OperationTeamName']) || request.operationTeamName || '',
      PriceWithTax: priceWithTax,
      PriceWithoutTax: priceWithoutTax,
      TaxRate: taxRate,
      SubtotalWithTax: subtotalWithTax,
      SubtotalWithoutTax: subtotalWithoutTax,
      IsTax: getFiniteNumber(targetSku['IsTax']) ?? request.isTax ?? 1,
      PurchasePrice: getFiniteNumber(targetSku['PurchasePrice']) ?? request.purchasePrice,
      IsBillingData: getFiniteNumber(targetSku['IsBillingData']) ?? request.isBillingData,
      BillingDataType: getString(targetSku['BillingDataType']) || request.billingDataType,
      BillingEntity: getString(targetSku['BillingEntity']) || request.billingEntity,
    },
  ];
}

function buildPurchaseOrderInput(
  detail: Record<string, unknown>,
  auditSkuInputs: Record<string, unknown>[],
  request: PurchaseApprovalRequest,
) {
  const sku = auditSkuInputs[0] ?? {};
  const approvalQuantity = getFiniteNumber(sku['ApprovalQuantity']) || request.qty;
  const warehouseId =
    getFiniteNumber(sku['WarehouseId']) ||
    request.warehouseId ||
    request.overseasWarehouseId ||
    request.virtualWarehouseId;
  const warehouseName =
    getString(sku['WarehouseName']) ||
    request.warehouseName ||
    request.overseasWarehouseName ||
    request.virtualWarehouseName ||
    '';
  const inputSubtotalTaxType = getFiniteNumber(sku['IsTax']) ?? request.isTax ?? 1;
  const inputSubtotal =
    inputSubtotalTaxType === 2
      ? getFiniteNumber(sku['SubtotalWithoutTax'])
      : getFiniteNumber(sku['SubtotalWithTax']);
  const applyNumber = getString(detail['Number']) || request.applyNumber || '';
  const operationTeamId = getFiniteNumber(sku['OperationTeamId']) ?? request.operationTeamId;
  const operationTeamName = getString(sku['OperationTeamName']) || request.operationTeamName || '';

  return {
    SourceApplyList: [
      {
        Id: getFiniteNumber(detail['Id']) || request.applyId,
        Skus: [
          {
            Id: getFiniteNumber(sku['Id']) || request.applySkuId,
            SupplierId: getFiniteNumber(sku['SupplierId']) || request.supplierId,
            SupplierName: getString(sku['SupplierName']) || request.supplierName,
            PurchaseUrl: getString(sku['PurchaseUrl']) || request.purchaseUrl || '',
            WarehouseId: warehouseId,
            WarehouseName: warehouseName,
          },
        ],
      },
    ],
    PurchaseOrderList: [
      {
        GoodsList: [
          {
            ...sku,
            Quantity: approvalQuantity,
            InputSubtotalTaxRate: getFiniteNumber(sku['TaxRate']) ?? request.taxRate,
            InputSubtotalTaxType: inputSubtotalTaxType,
            InputSubtotal: inputSubtotal,
            PurchaseGoodsOperationteam: operationTeamId
              ? [
                  {
                    OperationTeamId: operationTeamId,
                    OperationTeamName: operationTeamName,
                    PurchaseQuantity: approvalQuantity,
                  },
                ]
              : [],
          },
        ],
        PurchaseApplyNumber: applyNumber,
        PurchaseApplyNumbers: applyNumber ? [applyNumber] : [],
        WarehouseId: warehouseId,
        WarehouseName: warehouseName,
        SupplierId: getFiniteNumber(sku['SupplierId']) || request.supplierId,
        SupplierName: getString(sku['SupplierName']) || request.supplierName,
        ExpectArrivalDate: getString(detail['ExpectArrivalDate']) || request.estimatedArrivalDate,
        Remark: 'AI助手授权生成采购单',
        Quantity: approvalQuantity,
        CreateUserId: getFiniteNumber(detail['ApplicantId']),
        CreateUserName: getString(detail['Applicant']),
        OperationTeamId: operationTeamId,
        OperationTeamName: operationTeamName,
      },
    ],
  };
}

function toApprovalRequest(task: ApprovalTask, approvedQty?: number): PurchaseApprovalRequest {
  if (!approvedQty || approvedQty <= 0 || approvedQty === task.request.qty) {
    return task.request;
  }

  return {
    ...task.request,
    qty: approvedQty,
  };
}

export const purchaseApprovalWorkflow = {
  async approve(input: ApprovePurchaseWorkflowInput): Promise<AgentResult> {
    const task = await approvalTaskStore.get(input.approvalId);
    if (!task) {
      throw new Error(`审批任务不存在: ${input.approvalId}`);
    }

    if (task.status === 'completed') {
      return {
        taskId: task.taskId,
        status: 'completed',
        result: task.result ?? '审批任务已完成',
        steps: [],
        metadata: { approvalTask: task, approvalRequest: task.request },
      };
    }

    if (task.status !== 'waiting_for_approval' && task.status !== 'failed') {
      throw new Error(`审批任务当前状态为 ${task.status}，不能授权执行`);
    }

    const approvedRequest = toApprovalRequest(task, input.approvedQty);
    await approvalTaskStore.update(input.approvalId, {
      status: 'approved',
      request: approvedRequest,
      approvedBy: {
        operatorId: input.operatorId,
        operatorName: input.operatorName,
      },
      historyNote: '用户已授权，准备恢复 workflow',
    });
    await approvalTaskStore.update(input.approvalId, {
      status: 'running',
      request: approvedRequest,
      historyNote: '开始执行一审、二审、生成采购单',
    });

    try {
      const detail = await purchaseApi.getApplyDetailRaw(approvedRequest.applyId);
      const auditSkuInputs = buildAuditSkuInputs(detail, approvedRequest);

      await purchaseApi.firstAuditApply({
        ApplyId: approvedRequest.applyId,
        AuditApplySkuInputs: auditSkuInputs,
        Status: 1,
        Remark: 'AI助手授权执行一审',
      });

      await purchaseApi.secondAuditApply({
        ApplyId: approvedRequest.applyId,
        AuditApplySkuInputs: auditSkuInputs,
        Status: 1,
        Remark: 'AI助手授权执行二审',
      });

      const purchaseOrderInput = buildPurchaseOrderInput(detail, auditSkuInputs, approvedRequest);
      await purchaseApi.genPurchaseOrderFromApply(purchaseOrderInput);

      const result = `已完成一审、二审，并生成采购单。需求单：${approvedRequest.applyNumber || approvedRequest.applyId}`;
      const completedTask = await approvalTaskStore.update(input.approvalId, {
        status: 'completed',
        request: approvedRequest,
        result,
        workflowResult: {
          applyId: approvedRequest.applyId,
          applyNumber: approvedRequest.applyNumber,
          approvalQuantity: approvedRequest.qty,
          supplierId: approvedRequest.supplierId,
          supplierName: approvedRequest.supplierName,
          purchaseOrderInput,
        },
        historyNote: 'workflow 执行完成',
      });

      return {
        taskId: completedTask.taskId,
        status: 'completed',
        result,
        steps: [
          {
            stepIndex: 0,
            toolName: 'approval:first_audit',
            toolArgs: { applyId: approvedRequest.applyId },
            toolResult: { status: 'completed' },
            timestamp: new Date().toISOString(),
          },
          {
            stepIndex: 1,
            toolName: 'approval:second_audit',
            toolArgs: { applyId: approvedRequest.applyId },
            toolResult: { status: 'completed' },
            timestamp: new Date().toISOString(),
          },
          {
            stepIndex: 2,
            toolName: 'approval:gen_purchase_order',
            toolArgs: { applyId: approvedRequest.applyId },
            toolResult: { status: 'completed' },
            timestamp: new Date().toISOString(),
          },
        ],
        metadata: { approvalTask: completedTask, approvalRequest: completedTask.request },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedTask = await approvalTaskStore.update(input.approvalId, {
        status: 'failed',
        request: approvedRequest,
        errorMessage,
        result: '授权后的 workflow 执行失败，请到采购需求页面核对状态后处理。',
        historyNote: errorMessage,
      });

      return {
        taskId: failedTask.taskId,
        status: 'failed',
        result: failedTask.result ?? '授权后的 workflow 执行失败',
        steps: [],
        metadata: { approvalTask: failedTask, approvalRequest: failedTask.request, error: errorMessage },
      };
    }
  },

  async cancel(approvalId: string, operatorName?: string): Promise<ApprovalTask> {
    const task = await approvalTaskStore.get(approvalId);
    if (!task) {
      throw new Error(`审批任务不存在: ${approvalId}`);
    }

    if (task.status !== 'waiting_for_approval') {
      throw new Error(`审批任务当前状态为 ${task.status}，不能撤销`);
    }

    return approvalTaskStore.update(approvalId, {
      status: 'cancelled',
      approvedBy: { operatorName },
      historyNote: '用户撤销审批任务',
    });
  },

  async reject(
    approvalId: string,
    input?: {
      operatorId?: string;
      operatorName?: string;
      remark?: string;
    },
  ): Promise<AgentResult> {
    const task = await approvalTaskStore.get(approvalId);
    if (!task) {
      throw new Error(`审批任务不存在: ${approvalId}`);
    }

    if (task.status !== 'waiting_for_approval' && task.status !== 'failed') {
      throw new Error(`审批任务当前状态为 ${task.status}，不能执行驳回`);
    }

    await purchaseApi.rejectApply({
      ApplyId: task.request.applyId,
      Remark: input?.remark ?? 'AI助手审批卡片操作驳回',
    });

    const result = `已驳回需求单 ${task.request.applyNumber || task.request.applyId}，Agent 不会继续执行一审、二审和生成采购单。`;
    const rejectedTask = await approvalTaskStore.update(approvalId, {
      status: 'rejected',
      approvedBy: {
        operatorId: input?.operatorId,
        operatorName: input?.operatorName,
      },
      result,
      historyNote: input?.remark ?? '用户在审批卡片执行业务驳回',
    });

    return {
      taskId: rejectedTask.taskId,
      status: 'completed',
      result,
      steps: [
        {
          stepIndex: 0,
          toolName: 'approval:reject_apply',
          toolArgs: {
            applyId: task.request.applyId,
            remark: input?.remark ?? 'AI助手审批卡片操作驳回',
          },
          toolResult: { status: 'completed' },
          timestamp: new Date().toISOString(),
        },
      ],
      metadata: {
        approvalTask: rejectedTask,
        approvalRequest: rejectedTask.request,
      },
    };
  },
};
