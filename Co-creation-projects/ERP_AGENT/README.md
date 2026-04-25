# QQPGERP Agent 服务

基于 LLM Function Calling 的多 Agent 系统，用于**库存查询 + 物流协调 + 采购补货 + AI 客服问答**。

## 快速开始

### 1. 安装依赖
```bash
cd AGENT
pnpm install
```

### 2. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env，填写以下必填项：
# OPENAI_API_KEY=sk-xxx          （或 Gemini/Azure Key）
# LLM_MODEL=gpt-4o-mini
# LLM_BASE_URL=                  （非 OpenAI 服务填写，如 Gemini 填 https://generativelanguage.googleapis.com/v1beta/openai）
# ERP_API_BASE_URL=http://localhost:5000
# ERP_API_TOKEN=your-bearer-token
```

### 3. 启动服务
```bash
pnpm run dev       # 开发模式（热更新，监听 src 并自动重启）
pnpm run start:watch # 同 pnpm run dev，避免误用生产 start
pnpm run build     # 编译生产包
pnpm start         # 运行生产包
```

本地 ERP 前端链路会先请求 WebAPI 的 `AgentAssistant` 代理，WebAPI 再转发到 `qqpgerp-webapi/src/AceFx.WebApi/configs/agent_assistant.json` 中的 `AgentAssistant:BaseUrl`，当前是 `http://localhost:3101`。开发时请使用 `pnpm run dev` 或 `pnpm run start:watch` 启动 Agent；修改 `src/**/*.ts` 后进程会自动重启，不需要再手动 `pnpm run build` 和重启 `pnpm start`。

### 4. 运行示例
```bash
pnpm run example:inventory    # 库存查询示例
pnpm run example:logistics    # 物流协调 + 补货示例
pnpm run harness:customer-service  # AI 客服 RAG 与意图识别评测
```

---

## API 接口

### 自然语言对话
```
POST /api/agent/chat
Content-Type: application/json

{ "message": "查询 SKU-001 的库存，如果不足 10 件请触发补货" }
```

### AI 客服问答
```
POST /api/agent/customer-service/chat
Content-Type: application/json

{ "message": "开店服务费可以退款吗？", "sessionId": "cs-demo-001" }
```

也可以直接通过 `/api/agent/chat` 自动命中 `customer_service_faq` Skill。客服回复基于 `百问百答7.20（新）.docx` 构建的 LlamaIndex RAG 知识库；低置信命中会返回转人工提示。

### 订单处理（库存检查 + 物流协调）
```
POST /api/agent/order/808645169/process
```

### 低库存告警处理
```
POST /api/agent/stock-alert
Content-Type: application/json

{ "skuCode": "SKU-001", "currentQty": 5, "safetyQty": 50 }
```

### 健康检查
```
GET /health
```

---

## 项目结构

```
src/
├── core/
│   ├── types.ts          # 公共类型定义
│   ├── llm-client.ts     # LLM 客户端（OpenAI Function Calling + ReAct 循环）
│   ├── tool-registry.ts  # 工具注册中心
│   ├── agent-base.ts     # Agent 抽象基类
│   └── orchestrator.ts   # 主控 Agent
├── agents/
│   ├── inventory-agent.ts  # 库存查询 Agent
│   ├── logistics-agent.ts  # 物流协调 Agent
│   ├── purchase-agent.ts   # 采购补货 Agent
│   └── supplier-agent.ts   # 供应商通知 Agent
├── tools/
│   └── agent-tools.ts    # Agent 桥接工具层（Orchestrator 调用各 Agent 的适配器）
├── customer-service/     # AI 客服 FAQ 解析、意图识别、RAG 检索
├── skills/
│   ├── fulfillment-skill.ts
│   └── customer-service-skill.ts
├── api/                  # ERP WebAPI 客户端
│   ├── erp-client.ts
│   ├── inventory-api.ts
│   ├── logistics-api.ts
│   ├── purchase-api.ts
│   └── supplier-api.ts
├── config.ts             # 环境配置
├── logger.ts             # 结构化日志
├── server.ts             # Express HTTP 服务
└── index.ts              # 入口文件
```

---

## 支持的 LLM 服务

| 服务 | ENV 配置 |
|------|----------|
| OpenAI | `OPENAI_API_KEY=sk-xxx`, `LLM_MODEL=gpt-4o-mini` |
| Google Gemini | `OPENAI_API_KEY=AIza-xxx`, `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `LLM_MODEL=gemini-1.5-pro` |
| Azure OpenAI | `OPENAI_API_KEY=xxx`, `LLM_BASE_URL=https://<resource>.openai.azure.com`, `LLM_MODEL=gpt-4o` |
| 本地 Ollama | `OPENAI_API_KEY=ollama`, `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=llama3` |

---

## 对接 ERP API

所有工具通过 `ERP_API_BASE_URL` 对接现有 `AceFx.WebApi`，无需修改后端代码。

接口映射：

| Agent 工具 | ERP API 接口 |
|-----------|-------------|
| query_inventory | `GET /api/warehouse-stock/by-sku` |
| coordinate_logistics | `POST /api/out-order/create` + `POST /api/external-wms/push` |
| trigger_purchase | `POST /api/purchase-apply/create` |
| notify_supplier | `POST /api/supplier/notify` |
