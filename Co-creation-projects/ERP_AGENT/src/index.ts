import 'dotenv/config';
import { createApp } from './server';
import { initializeAgents } from './tools/agent-tools';
import { initializeSkills } from './skills';
import { getConfig } from './config';
import { logger } from './logger';

async function main(): Promise<void> {
  const cfg = getConfig();

  initializeAgents();
  initializeSkills();

  const app = createApp();
  app.listen(cfg.port, () => {
    logger.info(
      {
        port: cfg.port,
        model: cfg.llmModel,
        llmBaseUrl: cfg.llmBaseUrl || '(default)',
        erpApi: cfg.erpApiBaseUrl,
      },
      'QQPGERP Agent 服务已启动',
    );
    logger.info(`POST http://localhost:${cfg.port}/api/agent/chat`);
    logger.info(`POST http://localhost:${cfg.port}/api/agent/customer-service/chat`);
    logger.info(`GET  http://localhost:${cfg.port}/api/agent/skills`);
    logger.info(`POST http://localhost:${cfg.port}/api/agent/skills/:skillName/execute`);
    logger.info(`POST http://localhost:${cfg.port}/api/agent/order/:orderId/process`);
    logger.info(`POST http://localhost:${cfg.port}/api/agent/stock-alert`);
    logger.info(`POST http://localhost:${cfg.port}/api/agent/fulfillment`);
    logger.info(`GET  http://localhost:${cfg.port}/health`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('服务启动失败:', message);
  process.exit(1);
});
