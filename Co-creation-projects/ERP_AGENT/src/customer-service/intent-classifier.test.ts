import { classifyIntent } from './intent-classifier';

describe('classifyIntent', () => {
  it('优先保护履约链路', () => {
    const result = classifyIntent('SKU-09871 先叫仓库发货，不够的话再去催采购，采购再找供应商');
    expect(result.intent).toBe('fulfillment_flow');
  });

  it('识别客服 FAQ 意图', () => {
    const result = classifyIntent('开店服务费可以退款吗？');
    expect(result.intent).toBe('customer_service_faq');
  });

  it('识别春节抽奖活动为客服 FAQ 意图', () => {
    const result = classifyIntent('春节假期抽奖活动');
    expect(result.intent).toBe('customer_service_faq');
  });

  it('识别未知意图', () => {
    const result = classifyIntent('帮我写一首诗');
    expect(result.intent).toBe('unknown');
  });
});
