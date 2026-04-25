import { classifyIntent } from '../customer-service/intent-classifier';
import { customerServiceRag } from '../customer-service/rag-service';
import type { SkillDef } from '../core/types';

function getMessage(input: Record<string, unknown>): string {
  const message = input['message'] ?? input['question'];
  return typeof message === 'string' ? message.trim() : '';
}

export const customerServiceSkill: SkillDef = {
  name: 'customer_service_faq',
  description: '基于客服标准话术知识库回答服务费、企微、采购款、收益、跨境店、协议和 APP 操作问题。',
  triggers: ['客服', '服务费', '退款', '企微', '采购款', '充值', '收益', '提现', '跨境店', '协议', '小程序', '活动', '抽奖', '春节', '假期'],
  matches(message, context) {
    return classifyIntent(message, context).intent === 'customer_service_faq';
  },
  buildInput(message, context) {
    return {
      message,
      customerContext: context?.['customerContext'] ?? null,
    };
  },
  async execute(input) {
    const message = getMessage(input);
    if (!message) {
      throw new Error('customer_service_faq skill 缺少 message');
    }

    const classification = classifyIntent(message, { skillName: 'customer_service_faq' });
    const answer = await customerServiceRag.answer(message);

    return {
      result: answer.answer,
      metadata: {
        skillName: 'customer_service_faq',
        intent: classification.intent,
        confidence: Math.max(classification.confidence, answer.confidence),
        matchedCategory: answer.matchedCategory,
        retrievalHits: answer.retrievalHits,
        needsHuman: answer.needsHuman,
      },
    };
  },
};
