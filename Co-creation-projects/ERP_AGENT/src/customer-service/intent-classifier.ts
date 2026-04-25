export type AgentIntent =
  | 'customer_service_faq'
  | 'fulfillment_flow'
  | 'stock_alert'
  | 'order_process'
  | 'unknown';

export interface IntentClassification {
  intent: AgentIntent;
  confidence: number;
  reason: string;
}

const CUSTOMER_SERVICE_KEYWORDS = [
  '服务费',
  '开店服务费',
  '退款',
  '退费',
  '不想要',
  '不合作',
  '解除合作',
  '协议',
  '企微',
  '企业微信',
  '回访',
  '采购款',
  '充值',
  '提现',
  '收益',
  '跨境店',
  '虾皮',
  '活动',
  '抽奖',
  '春节',
  '服务费',
  '退款',
  '企微',
  '微信',
  '回访',
  '采购款',
  '充值',
  '云闪付',
  '银行卡',
  '收益',
  '提现',
  '回款',
  '跨境店',
  '虾皮',
  'shopee',
  '协议',
  '合作',
  '托管',
  '小程序',
  'app',
  '店主',
  '续约',
  '客服',
  '活动',
  '抽奖',
  '春节',
  '假期',
  '中奖',
  '奖品',
  '优惠券',
  '营业执照',
  '公司',
];

function hasSku(message: string): boolean {
  return /SKU-?[A-Za-z0-9_-]+|\b\d{4,}\b/i.test(message);
}

function hasAny(message: string, keywords: string[]): boolean {
  const lower = message.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function classifyIntent(
  message: string,
  context?: Record<string, unknown>,
): IntentClassification {
  const triggerType = context?.['triggerType'];
  const skillName = context?.['skillName'] ?? context?.['skill'];

  if (skillName === 'fulfillment_flow' || triggerType === 'fulfillment') {
    return { intent: 'fulfillment_flow', confidence: 1, reason: 'context 指定履约 skill' };
  }

  if (skillName === 'customer_service_faq' || triggerType === 'customer_service') {
    return { intent: 'customer_service_faq', confidence: 1, reason: 'context 指定客服 skill' };
  }

  if (triggerType === 'stock_alert' || (context?.['skuCode'] && context?.['safetyQty'])) {
    return { intent: 'stock_alert', confidence: 1, reason: 'context 指定库存预警' };
  }

  if (triggerType === 'order_approved' || context?.['orderId']) {
    return { intent: 'order_process', confidence: 1, reason: 'context 指定订单处理' };
  }

  const hasFulfillmentWords = /发货|出库|仓库/.test(message) && /采购|补货|催采购|供应商|催货/.test(message);
  if (hasSku(message) && hasFulfillmentWords) {
    return { intent: 'fulfillment_flow', confidence: 0.95, reason: '命中 SKU + 履约关键词' };
  }

  if (/库存预警|安全库存|缺口数量/.test(message) && hasSku(message)) {
    return { intent: 'stock_alert', confidence: 0.9, reason: '命中库存预警关键词' };
  }

  if (/订单\s*\d+|order\s*\d+/i.test(message) && /处理|审核|流程|发货/.test(message)) {
    return { intent: 'order_process', confidence: 0.85, reason: '命中订单处理关键词' };
  }

  if (hasAny(message, CUSTOMER_SERVICE_KEYWORDS)) {
    return { intent: 'customer_service_faq', confidence: 0.82, reason: '命中客服话术关键词' };
  }

  return { intent: 'unknown', confidence: 0.35, reason: '未命中明确业务意图' };
}
