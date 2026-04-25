/**
 * 示例：通过自然语言协调物流 + 触发补货
 * 运行: npm run example:logistics
 */
import 'dotenv/config';
import { initializeAgents } from '../src/tools/agent-tools';
import { orchestrator } from '../src/core/orchestrator';

async function main(): Promise<void> {
  initializeAgents();

  console.log('=== 示例: 订单处理（库存充足则发货，不足则补货）===');
  const result = await orchestrator.processOrder(808645169);
  console.log('状态:', result.status);
  console.log('结果:', result.result);
  console.log('');

  console.log('=== 示例: 低库存告警自动触发补货 ===');
  const alertResult = await orchestrator.processStockAlert('SKU-003', 2, 50);
  console.log('告警处理结果:', alertResult.result);
}

main().catch(console.error);
