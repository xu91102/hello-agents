import fs from 'fs/promises';
import os from 'os';
import path from 'path';

interface ApprovalCase {
  name: string;
  kind: 'approve' | 'patch_then_approve' | 'reject' | 'cancel' | 'timeout';
  approvalId: string;
  applyId: number;
  applyNumber: string;
  applySkuId: number;
  skuCode: string;
  qty: number;
  patchQty?: number;
  supplierId: number;
  supplierName: string;
  estimatedArrivalDate: string;
  detail?: Record<string, unknown>;
  expect: {
    finalTaskStatus: string;
    approvalQuantity?: number;
  };
}

interface ApprovalMetrics {
  approval_resume_success_rate: number;
  qty_patch_success_rate: number;
  reject_success_rate: number;
  cancel_success_rate: number;
  timeout_expiry_rate: number;
}

const THRESHOLDS: ApprovalMetrics = {
  approval_resume_success_rate: 1,
  qty_patch_success_rate: 1,
  reject_success_rate: 1,
  cancel_success_rate: 1,
  timeout_expiry_rate: 1,
};

function ratio(passed: number, total: number): number {
  return total === 0 ? 1 : passed / total;
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text) as T;
}

function buildRequest(testCase: ApprovalCase) {
  return {
    approvalId: testCase.approvalId,
    kind: 'purchase_apply_full_approval' as const,
    applyId: testCase.applyId,
    applyNumber: testCase.applyNumber,
    applySkuId: testCase.applySkuId,
    skuCode: testCase.skuCode,
    qty: testCase.qty,
    supplierId: testCase.supplierId,
    supplierName: testCase.supplierName,
    estimatedArrivalDate: testCase.estimatedArrivalDate,
    actions: ['first_audit', 'second_audit', 'gen_purchase_order'] as Array<'first_audit' | 'second_audit' | 'gen_purchase_order'>,
  };
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-approval-harness-'));
  const approvalStorePath = path.join(tempDir, 'approval-tasks.json');
  process.env['APPROVAL_TASK_STORAGE_PATH'] = approvalStorePath;
  process.env['APPROVAL_TASK_TIMEOUT_MS'] = '86400000';

  const [
    { approvalTaskStore, ApprovalTaskStore },
    { purchaseApprovalWorkflow },
    { purchaseApi },
  ] = await Promise.all([
    import('../src/core/approval-task-store'),
    import('../src/core/purchase-approval-workflow'),
    import('../src/api/purchase-api'),
  ]);

  const baseDir = path.resolve(process.cwd(), 'harness', 'approval');
  const cases = await readJson<ApprovalCase[]>(path.join(baseDir, 'cases.json'));

  const originalGetApplyDetailRaw = purchaseApi.getApplyDetailRaw;
  const originalFirstAuditApply = purchaseApi.firstAuditApply;
  const originalSecondAuditApply = purchaseApi.secondAuditApply;
  const originalGenPurchaseOrderFromApply = purchaseApi.genPurchaseOrderFromApply;
  const originalRejectApply = purchaseApi.rejectApply;

  let approvalPassed = 0;
  let approvalTotal = 0;
  let patchPassed = 0;
  let patchTotal = 0;
  let rejectPassed = 0;
  let rejectTotal = 0;
  let cancelPassed = 0;
  let cancelTotal = 0;
  let timeoutPassed = 0;
  let timeoutTotal = 0;

  const caseResults: Array<Record<string, unknown>> = [];

  try {
    for (const testCase of cases) {
      const callLog: Record<string, unknown>[] = [];
      purchaseApi.getApplyDetailRaw = async () => testCase.detail ?? {};
      purchaseApi.firstAuditApply = async (input: Record<string, unknown>) => {
        callLog.push({ fn: 'firstAuditApply', input });
      };
      purchaseApi.secondAuditApply = async (input: Record<string, unknown>) => {
        callLog.push({ fn: 'secondAuditApply', input });
      };
      purchaseApi.genPurchaseOrderFromApply = async (input: Record<string, unknown>) => {
        callLog.push({ fn: 'genPurchaseOrderFromApply', input });
      };
      purchaseApi.rejectApply = async (input: Record<string, unknown>) => {
        callLog.push({ fn: 'rejectApply', input });
      };

      let finalStatus = '';
      let approvalQuantity: number | undefined;
      let resultText = '';

      if (testCase.kind === 'timeout') {
        timeoutTotal++;
        const timeoutStore = new ApprovalTaskStore(path.join(tempDir, `${testCase.name}.json`), -1);
        const task = await timeoutStore.createPurchaseApprovalTask({ request: buildRequest(testCase) });
        const loaded = await timeoutStore.get(task.approvalId);
        finalStatus = loaded?.status ?? '';
        if (finalStatus === testCase.expect.finalTaskStatus) {
          timeoutPassed++;
        }
      } else {
        await approvalTaskStore.createPurchaseApprovalTask({ request: buildRequest(testCase) });

        if (testCase.kind === 'patch_then_approve') {
          patchTotal++;
          await approvalTaskStore.patchRequest(testCase.approvalId, { qty: testCase.patchQty });
        }

        if (testCase.kind === 'approve' || testCase.kind === 'patch_then_approve') {
          approvalTotal++;
          const result = await purchaseApprovalWorkflow.approve({
            approvalId: testCase.approvalId,
          });
          resultText = result.result;
          const task = await approvalTaskStore.get(testCase.approvalId);
          finalStatus = task?.status ?? '';
          approvalQuantity = task?.workflowResult?.['approvalQuantity'] as number | undefined;
          if (finalStatus === testCase.expect.finalTaskStatus) {
            approvalPassed++;
          }
          if (
            testCase.kind === 'patch_then_approve' &&
            approvalQuantity === testCase.expect.approvalQuantity
          ) {
            patchPassed++;
          }
        }

        if (testCase.kind === 'reject') {
          rejectTotal++;
          const result = await purchaseApprovalWorkflow.reject(testCase.approvalId, {
            remark: 'approval harness reject',
          });
          resultText = result.result;
          const task = await approvalTaskStore.get(testCase.approvalId);
          finalStatus = task?.status ?? '';
          if (finalStatus === testCase.expect.finalTaskStatus) {
            rejectPassed++;
          }
        }

        if (testCase.kind === 'cancel') {
          cancelTotal++;
          const task = await purchaseApprovalWorkflow.cancel(testCase.approvalId, 'approval-harness');
          finalStatus = task.status;
          if (finalStatus === testCase.expect.finalTaskStatus) {
            cancelPassed++;
          }
        }
      }

      caseResults.push({
        name: testCase.name,
        kind: testCase.kind,
        finalStatus,
        expectedStatus: testCase.expect.finalTaskStatus,
        approvalQuantity,
        expectedApprovalQuantity: testCase.expect.approvalQuantity,
        resultText,
        callLog,
      });
    }
  } finally {
    purchaseApi.getApplyDetailRaw = originalGetApplyDetailRaw;
    purchaseApi.firstAuditApply = originalFirstAuditApply;
    purchaseApi.secondAuditApply = originalSecondAuditApply;
    purchaseApi.genPurchaseOrderFromApply = originalGenPurchaseOrderFromApply;
    purchaseApi.rejectApply = originalRejectApply;
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  const metrics: ApprovalMetrics = {
    approval_resume_success_rate: ratio(approvalPassed, approvalTotal),
    qty_patch_success_rate: ratio(patchPassed, patchTotal),
    reject_success_rate: ratio(rejectPassed, rejectTotal),
    cancel_success_rate: ratio(cancelPassed, cancelTotal),
    timeout_expiry_rate: ratio(timeoutPassed, timeoutTotal),
  };

  process.stdout.write(JSON.stringify({ metrics, thresholds: THRESHOLDS, cases: caseResults }, null, 2) + '\n');

  const failed = Object.entries(THRESHOLDS).filter(([key, threshold]) => {
    return metrics[key as keyof ApprovalMetrics] < threshold;
  });
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`approval harness 执行失败: ${message}\n`);
  process.exit(1);
});
