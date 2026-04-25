import { classifyIntent } from './intent-classifier';

describe('classifyIntent real Chinese inputs', () => {
  it('识别服务费退款问题为客服 FAQ 意图', () => {
    const result = classifyIntent('我不想要服务费，可以退款吗');
    expect(result.intent).toBe('customer_service_faq');
  });
});
