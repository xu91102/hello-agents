import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ApprovalTaskStore } from './approval-task-store';
import type { PurchaseApprovalRequest } from './types';

function buildRequest(): Omit<PurchaseApprovalRequest, 'taskId' | 'status' | 'expiresAt'> {
  return {
    approvalId: 'approval-test-1',
    kind: 'purchase_apply_full_approval' as const,
    applyId: 1001,
    applySkuId: 2001,
    skuCode: 'WGXB02000201',
    qty: 2,
    supplierId: 3001,
    supplierName: '测试供应商',
    estimatedArrivalDate: '2026-04-30',
    actions: ['first_audit', 'second_audit', 'gen_purchase_order'],
  };
}

describe('ApprovalTaskStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-approval-store-'));
    filePath = path.join(dir, 'approval-tasks.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('创建审批任务后可以从文件恢复', async () => {
    const store = new ApprovalTaskStore(filePath, 60_000);
    const created = await store.createPurchaseApprovalTask({ request: buildRequest() });

    const reloadedStore = new ApprovalTaskStore(filePath, 60_000);
    const loaded = await reloadedStore.get(created.approvalId);

    expect(loaded?.status).toBe('waiting_for_approval');
    expect(loaded?.request.taskId).toBe(created.taskId);
    expect(loaded?.request.qty).toBe(2);
  });

  it('等待审批状态允许修改数量', async () => {
    const store = new ApprovalTaskStore(filePath, 60_000);
    const created = await store.createPurchaseApprovalTask({ request: buildRequest() });

    const patched = await store.patchRequest(created.approvalId, { qty: 5 });

    expect(patched.request.qty).toBe(5);
    expect(patched.status).toBe('waiting_for_approval');
  });

  it('超过超时时间后自动标记为 expired', async () => {
    const store = new ApprovalTaskStore(filePath, -1);
    const created = await store.createPurchaseApprovalTask({ request: buildRequest() });

    const loaded = await store.get(created.approvalId);

    expect(loaded?.status).toBe('expired');
    expect(loaded?.request.status).toBe('expired');
  });
});
