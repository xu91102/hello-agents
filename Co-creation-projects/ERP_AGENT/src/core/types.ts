/**
 * 公共类型定义
 * 覆盖 Agent 任务、工具调用、消息协议等核心数据结构
 */

// ----------------------------------------------------------------
// 工具定义（映射到 OpenAI Function Calling Schema）
// ----------------------------------------------------------------

/** 工具参数属性定义 */
export interface ToolPropertyDef {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolPropertyDef;
}

/** 工具参数 Schema */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolPropertyDef>;
  required?: string[];
}

/** 工具定义 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /** 实际执行函数 */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SkillExecuteResult {
  result: string;
  metadata?: Record<string, unknown>;
}

export interface SkillDef {
  name: string;
  description: string;
  triggers: string[];
  matches: (message: string, context?: Record<string, unknown>) => boolean;
  buildInput: (message: string, context?: Record<string, unknown>) => Record<string, unknown> | null;
  execute: (input: Record<string, unknown>) => Promise<SkillExecuteResult>;
}

// ----------------------------------------------------------------
// 消息协议
// ----------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface BaseMessage {
  role: MessageRole;
  content: string | null;
}

export interface ToolCallInfo {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  tool_calls?: ToolCallInfo[];
}

export interface ToolResultMessage extends BaseMessage {
  role: 'tool';
  tool_call_id: string;
}

export type ChatMessage = BaseMessage | AssistantMessage | ToolResultMessage;

// ----------------------------------------------------------------
// Agent 任务与结果
// ----------------------------------------------------------------

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'partial';

/** Agent 执行的单个步骤记录 */
export interface AgentStep {
  stepIndex: number;
  thought?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  error?: string;
  timestamp: string;
}

/** Agent 任务 */
export interface AgentTask {
  taskId: string;
  type: 'chat' | 'order_process' | 'stock_alert';
  input: Record<string, unknown>;
  status: TaskStatus;
  steps: AgentStep[];
  result?: string;
  createdAt: string;
  updatedAt: string;
}

/** Agent 执行结果 */
export interface AgentResult {
  taskId: string;
  status: TaskStatus;
  result: string;
  steps: AgentStep[];
  metadata?: Record<string, unknown>;
}

export type ApprovalTaskStatus =
  | 'waiting_for_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PurchaseApprovalAction =
  | 'first_audit'
  | 'second_audit'
  | 'gen_purchase_order';

export interface PurchaseApprovalRequest {
  approvalId: string;
  taskId: string;
  kind: 'purchase_apply_full_approval';
  status: ApprovalTaskStatus;
  applyId: number;
  applyNumber?: string;
  applySkuId?: number;
  skuCode: string;
  goodsName?: string;
  skuId?: number;
  skuSpecName?: string;
  qty: number;
  supplierId: number;
  supplierName: string;
  estimatedArrivalDate: string;
  warehouseId?: number;
  warehouseName?: string;
  overseasWarehouseId?: number;
  overseasWarehouseName?: string;
  virtualWarehouseId?: number;
  virtualWarehouseName?: string;
  operationTeamId?: number;
  operationTeamName?: string;
  purchaseUrl?: string;
  priceWithTax?: number;
  priceWithoutTax?: number;
  taxRate?: number;
  subtotalWithTax?: number;
  subtotalWithoutTax?: number;
  isTax?: number;
  purchasePrice?: number;
  isBillingData?: number;
  billingDataType?: string;
  billingEntity?: string;
  actions: PurchaseApprovalAction[];
  expiresAt?: string;
}

export interface ApprovalTaskHistoryItem {
  status: ApprovalTaskStatus;
  at: string;
  operatorId?: string;
  operatorName?: string;
  note?: string;
}

export interface ApprovalTask {
  taskId: string;
  approvalId: string;
  workflowName: 'purchase_apply_full_approval';
  status: ApprovalTaskStatus;
  request: PurchaseApprovalRequest;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  approvedAt?: string;
  approvedBy?: {
    operatorId?: string;
    operatorName?: string;
  };
  result?: string;
  workflowResult?: Record<string, unknown>;
  errorMessage?: string;
  history: ApprovalTaskHistoryItem[];
}

// ----------------------------------------------------------------
// ERP 业务数据类型（对接 AceFx WebAPI DTO）
// ----------------------------------------------------------------

/** 库存信息 */
export interface InventoryInfo {
  skuCode: string;
  skuId?: number;
  skuName?: string;
  productName?: string;
  itemNo?: string;
  warehouseClassification?: number | null;
  operationTeamId?: number | null;
  status?: number;
  statusText?: string;
  highWarnNum?: number | null;
  ordinaryWarnNum?: number | null;
  safetyStock?: number | null;
  warehouseId: number;
  warehouseName: string;
  totalQty: number;
  availableQty: number;
  lockedQty: number;
}

/** 库存决策 */
export type InventoryDecisionStatus = 'sufficient' | 'insufficient' | 'empty';

export interface InventoryDecision {
  skuCode: string;
  requiredQty: number;
  availableQty: number;
  status: InventoryDecisionStatus;
  warehouseId?: number;
}

/** 物流渠道 */
export interface LogisticsChannel {
  channelId: number;
  channelName: string;
  providerId: number;
  providerName: string;
  destinationCountries: string[];
  estimatedDays: number;
  costPerKg: number;
}

/** 出库单 */
export interface OutOrder {
  outOrderId: number;
  orderId: number;
  channelId: number;
  channelName: string;
  status: string;
  createdAt: string;
}

/** 采购申请 */
export interface PurchaseApply {
  applyId?: number;
  skuCode: string;
  qty: number;
  supplierId: number;
  supplierName: string;
  estimatedArrivalDate: string;
  status: string;
  applyCreated?: boolean;
  applyNumber?: string;
  remark?: string;
  applySkuId?: number;
  goodsId?: number;
  goodsName?: string;
  skuId?: number;
  skuSpecName?: string;
  itemNo?: string;
  warehouseId?: number;
  warehouseName?: string;
  overseasWarehouseId?: number;
  overseasWarehouseName?: string;
  virtualWarehouseId?: number;
  virtualWarehouseName?: string;
  operationTeamId?: number;
  operationTeamName?: string;
  purchaseUrl?: string;
  applyQuantity?: number;
  approvalQuantity?: number;
  priceWithTax?: number;
  priceWithoutTax?: number;
  taxRate?: number;
  subtotalWithTax?: number;
  subtotalWithoutTax?: number;
  isTax?: number;
  purchasePrice?: number;
  isBillingData?: number;
  billingDataType?: string;
  billingEntity?: string;
}

export interface SupplierCandidate {
  supplierId: number;
  supplierName: string;
  unitPrice: number;
  leadDays: number;
  rating: number;
  purchaseUrl?: string;
  isDefault?: boolean;
  goodsId?: number;
  skuId?: number;
  goodsName?: string;
  skuSpecName?: string;
  billingDataType?: string;
  billingEntity?: string;
  taxRate?: number;
  isTax?: number;
}

export interface SupplierNotificationResult {
  supplierId: number;
  supplierName: string;
  notified: boolean;
  manualFollowUpRequired: boolean;
  notifyId?: string;
  sentAt?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  message: string;
}

export interface FulfillmentLineInput {
  skuCode: string;
  requiredQty: number;
}

export interface FulfillmentAllocation {
  warehouseId: number;
  warehouseName: string;
  qty: number;
}

export interface FulfillmentLineResult {
  skuCode: string;
  requiredQty: number;
  availableQty: number;
  shippedQty: number;
  shortageQty: number;
  status: 'ready_to_ship' | 'partial_purchase_required' | 'purchase_required';
  allocations: FulfillmentAllocation[];
  purchase?: PurchaseApply;
  supplierNotification?: SupplierNotificationResult;
}

/** API 分页响应 */
export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** ERP API 标准响应 */
export interface ErpApiResponse<T = unknown> {
  code: number;
  message: string | null;
  data: T;
  success?: boolean;
}
