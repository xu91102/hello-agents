import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  logLevel: string;
  openaiApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  /** LLM 请求超时（毫秒），Ollama 等本地模型可设大一些 */
  llmTimeoutMs: number;
  erpApiBaseUrl: string;
  erpApiToken: string;
  erpLoginUsername: string;
  erpLoginPassword: string;
  maxAgentSteps: number;
  toolTimeoutMs: number;
  memoryMaxMessages: number;
  memorySummaryMaxChars: number;
  memoryTtlMs: number;
  customerServiceDocxPath: string;
  ragTopK: number;
  ragMinScore: number;
  ragEmbeddingModel: string;
  ragStorageDir: string;
  approvalTaskStoragePath: string;
  approvalTaskTimeoutMs: number;
}

let _config: AppConfig | null = null;

/**
 * 获取全局配置（懒加载，首次调用时从环境变量读取）
 */
export function getConfig(): AppConfig {
  if (_config) return _config;

  const ollamaBase = process.env['OLLAMA_BASE_URL'] ?? '';
  const ollamaModel = process.env['OLLAMA_MODEL'] ?? '';
  const ollamaTimeout = process.env['OLLAMA_TIMEOUT'];
  // OpenAI SDK 请求 path 为 /chat/completions（不含 v1），Ollama 等兼容接口在 /v1/chat/completions，故 base 需带 /v1
  const llmBaseUrlRaw = ollamaBase || (process.env['LLM_BASE_URL'] ?? '');
  const llmBaseUrl =
    ollamaBase && llmBaseUrlRaw && !llmBaseUrlRaw.replace(/\/$/, '').endsWith('/v1')
      ? llmBaseUrlRaw.replace(/\/$/, '') + '/v1'
      : llmBaseUrlRaw;
  _config = {
    port: parseInt(process.env['PORT'] ?? '3100', 10),
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
    openaiApiKey: process.env['OPENAI_API_KEY'] ?? '',
    llmModel: ollamaBase ? (ollamaModel || 'llama2') : (process.env['LLM_MODEL'] ?? 'gpt-4o-mini'),
    llmBaseUrl,
    llmTimeoutMs: ollamaTimeout
      ? parseInt(ollamaTimeout, 10) * 1000
      : parseInt(process.env['LLM_TIMEOUT_MS'] ?? '60000', 10),
    erpApiBaseUrl: process.env['ERP_API_BASE_URL'] ?? 'http://localhost:5000',
    erpApiToken: process.env['ERP_API_TOKEN'] ?? '',
    erpLoginUsername: process.env['ERP_LOGIN_USERNAME'] ?? '',
    erpLoginPassword: process.env['ERP_LOGIN_PASSWORD'] ?? '',
    maxAgentSteps: parseInt(process.env['MAX_AGENT_STEPS'] ?? '10', 10),
    toolTimeoutMs: parseInt(process.env['TOOL_TIMEOUT_MS'] ?? '30000', 10),
    memoryMaxMessages: parseInt(process.env['MEMORY_MAX_MESSAGES'] ?? '10', 10),
    memorySummaryMaxChars: parseInt(process.env['MEMORY_SUMMARY_MAX_CHARS'] ?? '2000', 10),
    memoryTtlMs: parseInt(process.env['MEMORY_TTL_MS'] ?? '1800000', 10),
    customerServiceDocxPath: process.env['CUSTOMER_SERVICE_DOCX_PATH']
      ? path.resolve(process.env['CUSTOMER_SERVICE_DOCX_PATH'])
      : path.resolve(process.cwd(), '..', '..', '百问百答7.20（新）.docx'),
    ragTopK: parseInt(process.env['RAG_TOP_K'] ?? '3', 10),
    ragMinScore: parseFloat(process.env['RAG_MIN_SCORE'] ?? '0.22'),
    ragEmbeddingModel: process.env['RAG_EMBEDDING_MODEL'] ?? 'local-hash-embedding',
    ragStorageDir: path.resolve(process.env['RAG_STORAGE_DIR'] ?? path.join(process.cwd(), 'data', 'customer-service-rag')),
    approvalTaskStoragePath: path.resolve(
      process.env['APPROVAL_TASK_STORAGE_PATH'] ?? path.join(process.cwd(), 'data', 'approval-tasks.json'),
    ),
    approvalTaskTimeoutMs: parseInt(process.env['APPROVAL_TASK_TIMEOUT_MS'] ?? '86400000', 10),
  };

  return _config;
}
