import { parseCustomerServiceFaqText } from './faq-parser';

describe('parseCustomerServiceFaqText', () => {
  it('按章节解析客服问答', () => {
    const items = parseCustomerServiceFaqText(
      [
        '一、关于服务费类别的事宜：',
        '1、交了开店服务费后，我可以申请退款吗？',
        '回复：三天考虑期内可以申请退款。',
        '二、关于采购款及充值事宜：',
        '1、采购款该如何支付？',
        '回复：通过 APP 或小程序充值到 ID 余额。',
      ].join('\n'),
      '百问百答.docx',
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'faq-0001',
      category: '一、关于服务费类别的事宜',
      question: '交了开店服务费后，我可以申请退款吗？',
      answer: '三天考虑期内可以申请退款。',
    });
    expect(items[1].category).toBe('二、关于采购款及充值事宜');
  });

  it('解析问题和回复在同一行的问答', () => {
    const items = parseCustomerServiceFaqText(
      [
        '八、关于APP或小程序的操作问题：',
        '7、请问春节假期是不是有抽奖活动?回复：在春节期间，我们在APP及小程序里面准备了精彩的抽奖活动。',
        '抽奖时间为 1 月 28 日至 2 月 4 日。',
      ].join('\n'),
      '百问百答.docx',
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: '八、关于APP或小程序的操作问题',
      question: '请问春节假期是不是有抽奖活动?',
      answer: '在春节期间，我们在APP及小程序里面准备了精彩的抽奖活动。\n抽奖时间为 1 月 28 日至 2 月 4 日。',
    });
  });
});
