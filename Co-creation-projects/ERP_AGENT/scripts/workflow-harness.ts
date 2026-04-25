import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { InventoryInfo, PurchaseApply, ToolDef } from '../src/core/types';

interface WorkflowCase {
  name: string;
  queryArgs: Record<string, unknown>;
  inventoryRows: InventoryInfo[];
  purchaseApply?: PurchaseApply;
  expect: {
    queryType: 'sku' | 'productName';
    status: string;
    alertLevel: string;
    procurementRequired: boolean;
    deficitQty: number;
    shouldTriggerPurchase: boolean;
    workflowStatus?: string;
    inventoryMethod: 'sku' | 'productName';
    purchaseMapping?: {
      warehouseId?: number | null;
      overseasWarehouseId?: number | null;
      virtualWarehouseId?: number | null;
      operationTeamId?: number | null;
    };
  };
}

interface WorkflowMetrics {
  inventory_decision_accuracy: number;
  query_routing_accuracy: number;
  purchase_pause_rate: number;
  warehouse_mapping_accuracy: number;
}

const THRESHOLDS: WorkflowMetrics = {
  inventory_decision_accuracy: 1,
  query_routing_accuracy: 1,
  purchase_pause_rate: 1,
  warehouse_mapping_accuracy: 1,
};

function ratio(passed: number, total: number): number {
  return total === 0 ? 1 : passed / total;
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-workflow-harness-'));
  process.env['APPROVAL_TASK_STORAGE_PATH'] = path.join(tempDir, 'approval-tasks.json');

  const [{ buildOrchestratorTools }, { inventoryApi }, { purchaseAgent }] = await Promise.all([
    import('../src/tools/agent-tools'),
    import('../src/api/inventory-api'),
    import('../src/agents/purchase-agent'),
  ]);

  const baseDir = path.resolve(process.cwd(), 'harness', 'workflow');
  const cases = await readJson<WorkflowCase[]>(path.join(baseDir, 'cases.json'));
  const tools = buildOrchestratorTools();
  const queryTool = tools.find((tool) => tool.name === 'query_inventory');
  const purchaseTool = tools.find((tool) => tool.name === 'trigger_purchase');

  if (!queryTool || !purchaseTool) {
    throw new Error('workflow harness 初始化失败，未找到 query_inventory 或 trigger_purchase 工具');
  }

  const originalGetStockBySku = inventoryApi.getStockBySku;
  const originalGetStockByProductName = inventoryApi.getStockByProductName;
  const originalCreateApplyDirect = purchaseAgent.createApplyDirect.bind(purchaseAgent);

  let inventoryDecisionPassed = 0;
  let queryRoutingPassed = 0;
  let purchasePausePassed = 0;
  let purchasePauseTotal = 0;
  let warehouseMappingPassed = 0;
  let warehouseMappingTotal = 0;

  const caseResults: Array<Record<string, unknown>> = [];

  try {
    for (const testCase of cases) {
      let inventoryMethod: 'sku' | 'productName' | undefined;
      let capturedPurchaseArgs: Record<string, unknown> | null = null;

      inventoryApi.getStockBySku = async () => {
        inventoryMethod = 'sku';
        return testCase.inventoryRows;
      };
      inventoryApi.getStockByProductName = async () => {
        inventoryMethod = 'productName';
        return testCase.inventoryRows;
      };
      purchaseAgent.createApplyDirect = async (params: Record<string, unknown>) => {
        capturedPurchaseArgs = params;
        if (!testCase.purchaseApply) {
          throw new Error(`case ${testCase.name} 缺少 purchaseApply mock 数据`);
        }
        return testCase.purchaseApply;
      };

      const queryResult = await queryTool.execute(testCase.queryArgs);
      if (!isRecord(queryResult)) {
        throw new Error(`case ${testCase.name} 的 query_inventory 返回值异常`);
      }

      const decisions = Array.isArray(queryResult['decisions'])
        ? queryResult['decisions']
        : [];
      const firstDecision = decisions[0] as Record<string, unknown> | undefined;
      if (!firstDecision) {
        throw new Error(`case ${testCase.name} 未生成库存决策`);
      }

      const decisionPass =
        firstDecision['queryType'] === testCase.expect.queryType &&
        firstDecision['status'] === testCase.expect.status &&
        firstDecision['alertLevel'] === testCase.expect.alertLevel &&
        firstDecision['procurementRequired'] === testCase.expect.procurementRequired &&
        firstDecision['deficitQty'] === testCase.expect.deficitQty;
      if (decisionPass) {
        inventoryDecisionPassed++;
      }

      if (inventoryMethod != null && inventoryMethod === testCase.expect.inventoryMethod) {
        queryRoutingPassed++;
      }

      let purchaseResult: Record<string, unknown> | null = null;
      if (testCase.expect.shouldTriggerPurchase) {
        purchasePauseTotal++;
        const triggerWarehouse = isRecord(firstDecision['triggerWarehouse'])
          ? firstDecision['triggerWarehouse']
          : {};
        const result = await purchaseTool.execute({
          sku_code: testCase.inventoryRows[0]?.skuCode,
          deficit_qty: firstDecision['deficitQty'],
          stock_warehouse_id: triggerWarehouse['warehouseId'],
          stock_warehouse_name: triggerWarehouse['warehouseName'],
          stock_warehouse_classification: triggerWarehouse['warehouseClassification'],
          operation_team_id: triggerWarehouse['operationTeamId'],
        });
        if (!isRecord(result)) {
          throw new Error(`case ${testCase.name} 的 trigger_purchase 返回值异常`);
        }
        purchaseResult = result;

        const approvalRequest = isRecord(result['approvalRequest'])
          ? result['approvalRequest']
          : null;
        if (
          result['workflowStatus'] === testCase.expect.workflowStatus &&
          approvalRequest?.['status'] === 'waiting_for_approval'
        ) {
          purchasePausePassed++;
        }

        if (testCase.expect.purchaseMapping) {
          warehouseMappingTotal++;
          const mappingPass =
            (capturedPurchaseArgs?.['warehouseId'] ?? null) === (testCase.expect.purchaseMapping.warehouseId ?? null) &&
            (capturedPurchaseArgs?.['overseasWarehouseId'] ?? null) === (testCase.expect.purchaseMapping.overseasWarehouseId ?? null) &&
            (capturedPurchaseArgs?.['virtualWarehouseId'] ?? null) === (testCase.expect.purchaseMapping.virtualWarehouseId ?? null) &&
            (capturedPurchaseArgs?.['operationTeamId'] ?? null) === (testCase.expect.purchaseMapping.operationTeamId ?? null);
          if (mappingPass) {
            warehouseMappingPassed++;
          }
        }
      }

      caseResults.push({
        name: testCase.name,
        passed: decisionPass && inventoryMethod != null && inventoryMethod === testCase.expect.inventoryMethod,
        decision: firstDecision,
        inventoryMethod,
        purchaseResult,
        capturedPurchaseArgs,
      });
    }
  } finally {
    inventoryApi.getStockBySku = originalGetStockBySku;
    inventoryApi.getStockByProductName = originalGetStockByProductName;
    purchaseAgent.createApplyDirect = originalCreateApplyDirect;
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  const metrics: WorkflowMetrics = {
    inventory_decision_accuracy: ratio(inventoryDecisionPassed, cases.length),
    query_routing_accuracy: ratio(queryRoutingPassed, cases.length),
    purchase_pause_rate: ratio(purchasePausePassed, purchasePauseTotal),
    warehouse_mapping_accuracy: ratio(warehouseMappingPassed, warehouseMappingTotal),
  };

  process.stdout.write(JSON.stringify({ metrics, thresholds: THRESHOLDS, cases: caseResults }, null, 2) + '\n');

  const failed = Object.entries(THRESHOLDS).filter(([key, threshold]) => {
    return metrics[key as keyof WorkflowMetrics] < threshold;
  });
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`workflow harness 执行失败: ${message}\n`);
  process.exit(1);
});
