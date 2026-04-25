/**
 * 示例：通过自然语言查询库存
 * 运行: npm run example:inventory
 */
import 'dotenv/config';
import { initializeAgents } from '../src/tools/agent-tools';
import { orchestrator } from '../src/core/orchestrator';

async function main(): Promise<void> {
  // 初始化 Agent 工具
  initializeAgents();

  console.log('=== 示例 1: 查询单个 SKU 库存 ===');
  const result1 = await orchestrator.chat(
    '帮我查一下 SKU-001 在所有仓库的库存情况',
  );
  console.log('结果:', result1.result);
  console.log('步骤数:', result1.steps.length);
  console.log('');

  console.log('=== 示例 2: 批量查询并判断是否可以发货 ===');
  const result2 = await orchestrator.chat(
    '我有一个订单需要 SKU-001 × 10 件和 SKU-002 × 5 件，请检查库存是否够发货',
  );
  console.log('结果:', result2.result);
  console.log('');

  console.log('=== 详细步骤记录 ===');
  result2.steps.forEach((step, i) => {
    console.log(`步骤 ${i + 1}: 工具=${step.toolName ?? '思考'}`);
    if (step.toolArgs) console.log('  参数:', JSON.stringify(step.toolArgs));
    if (step.toolResult) console.log('  结果:', JSON.stringify(step.toolResult).slice(0, 100) + '...');
  });
}

main().catch(console.error);
