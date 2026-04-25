# QQPGERP Agent 项目简历描述

## 简历可直接使用版本

**QQPGERP ERP AI 助手 / 多 Agent 业务编排系统**

项目描述：  
基于 Node.js、TypeScript、Express、OpenAI Function Calling 兼容协议与 LlamaIndex.TS，为 QQPGERP ERP 系统建设 AI 助手能力，支持自然语言库存查询、库存预警、采购补货、供应商协同、AI 客服 FAQ 问答及工具调用过程审计。

技术栈：  
TypeScript、Node.js、Express、OpenAI SDK、Function Calling、ReAct、LlamaIndex.TS、RAG、Mammoth、Axios、Pino、Jest、pnpm、ERP WebAPI

项目职责与成果：

- 设计并实现 `Orchestrator + Skill + Workflow + Tool` 的 Agent 编排架构，将自然语言请求路由到库存查询、履约流程、采购补货、供应商协同和客服 FAQ 等业务能力。
- 实现 LLM Function Calling / ReAct 多轮工具调用链路，支持工具注册、参数 schema 转换、工具执行、步骤追踪和结构化 `AgentResult` 返回，便于前端展示和问题排查。
- 建设强约束履约 Workflow：先查询 ERP 实时库存，再按库存情况判断是否触发采购补货，并在缺货场景下协同供应商，避免关键业务链路完全依赖 LLM 自由推理。
- 对接 QQPGERP WebAPI，封装库存、采购、供应商、物流等领域 API Client，统一处理认证头、ERP 响应解包、异常降级和 PascalCase 字段映射。
- 新增 AI 客服能力：解析 `百问百答7.20（新）.docx` 客服话术文档，基于 LlamaIndex.TS 构建 RAG 检索，命中服务费退款、企微回访、采购款充值、收益提现、跨境店、协议条款、APP/小程序操作、春节活动等 FAQ 场景。
- 实现 AI 意图识别模块，区分 `customer_service_faq`、`fulfillment_flow`、`stock_alert`、`order_process`、`unknown` 等意图，保护 ERP 履约链路，同时避免客服知识库问题误触发库存或采购工具。
- 增加离线评测 Harness，覆盖意图识别准确率、FAQ Top3 检索命中率、回答关键词通过率、未知问题拒答率，并通过 `pnpm run harness:customer-service` 接入本地验证流程。
- 完成 ERP 前端 AI 助手联调，支持 SSE 流式消息、工具调用过程展示、输入摘要/结果摘要折叠、消息复制、重新生成、点赞/踩等交互能力。
- 优化开发体验，使用 pnpm 与 `ts-node-dev` 提供热更新开发模式，减少 TypeScript Agent 服务改动后的手动构建和重启成本。

## 精简版

**QQPGERP ERP AI 助手 / 多 Agent 业务编排系统**  
基于 TypeScript、Node.js、Express、OpenAI Function Calling 和 LlamaIndex.TS，为 ERP 系统建设 AI 助手能力。负责设计 `Orchestrator + Skill + Workflow + Tool` 架构，实现自然语言库存查询、库存预警、采购补货、供应商协同、AI 客服 RAG 问答和工具调用审计；对接 ERP WebAPI，封装库存、采购、供应商、物流等 API Client；建设客服 FAQ docx 解析、意图识别、低置信转人工及离线评测 Harness，提升业务链路可控性与可验证性。

## 面试展开版

### 架构亮点

- 使用 Orchestrator 作为统一调度入口，先匹配业务 Skill，未命中再进入 LLM + Tools 模式。
- 将高确定性的履约流程固化为 Workflow，降低 LLM 在采购、发货、供应商协同等业务链路上的不确定性。
- Tool 层只暴露原子能力，例如库存查询、采购补货、供应商通知；Skill 层负责稳定业务套路，例如 `fulfillment_flow` 与 `customer_service_faq`。
- 通过 `AgentResult.steps` 记录每一次工具调用的输入、输出与时间戳，支持前端折叠展示和联调追踪。

### AI 客服与 RAG

- 使用 Mammoth 从 docx 客服话术文档中抽取文本，并解析为结构化 FAQ：`id`、`category`、`question`、`answer`、`sourceDoc`、`sourceSection`。
- 使用 LlamaIndex.TS 建立客服知识库索引，基于 RAG 检索命中标准话术，再返回客服回答。
- 对低置信或未知问题采取转人工策略，避免模型编造服务承诺或政策口径。
- 针对“春节假期抽奖活动”等活动类话术补充意图识别与解析测试，避免知识库问题误触发履约工具。

### ERP 业务集成

- 库存查询对齐 ERP 实际库存页接口，使用 SKU / 商品名称查询真实库存，并兼容 ERP 返回字段格式。
- 采购补货根据库存缺口、预警等级和供应商候选数据生成采购建议，并对 ERP 建单失败做人工兜底。
- Agent 与 WebAPI 采用系统 token 鉴权，后端权限过滤器识别 `IsAdmin` claim，解决 Agent 系统调用误判无权限的问题。

### 工程化与质量保障

- 使用 Jest 覆盖 docx 解析、意图识别等核心逻辑。
- 使用客服 Harness 覆盖意图识别、RAG 检索命中、关键词回答、未知问题拒答等指标。
- 使用 pnpm 管理依赖，使用 `ts-node-dev` 支持开发态热更新。
- 使用 Pino 输出结构化日志，便于排查 Agent 调用链路、ERP 请求和 RAG 加载过程。

## 可量化表达参考

- 将 ERP AI 助手从单纯 LLM 工具调用升级为 `Skill + Workflow + RAG + Harness` 的混合架构，提升业务流程可控性。
- 将客服话术从静态 docx 文档转为可检索 FAQ 知识库，支持自动问答、低置信转人工和离线评测。
- 通过离线 Harness 对客服 FAQ 与意图识别进行回归验证，降低新增话术或路由规则后的误触发风险。

## 一句话介绍

这是一个面向 ERP 真实业务场景的 AI Agent 系统，不只是聊天机器人，而是把自然语言入口、工具调用、固定业务流程、知识库问答和评测治理整合到同一个工程里的业务编排平台。
