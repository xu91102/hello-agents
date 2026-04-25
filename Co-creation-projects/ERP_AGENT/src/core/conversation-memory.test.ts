import { conversationMemory } from './conversation-memory';

describe('conversationMemory', () => {
  afterEach(() => {
    conversationMemory.clear('memory-test-session');
  });

  it('至少保留最近 5 轮完整对话，并压缩更早记忆', () => {
    const sessionId = 'memory-test-session';

    for (let i = 1; i <= 7; i++) {
      conversationMemory.appendExchange(sessionId, `用户问题 ${i}`, `助手回答 ${i}`);
    }

    const snapshot = conversationMemory.getSession(sessionId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.messageCount).toBe(10);
    expect(snapshot?.compressedMessageCount).toBe(4);
    expect(snapshot?.summary).toContain('用户问题 1');
    expect(snapshot?.summary).toContain('助手回答 2');
    expect(snapshot?.messages[0]).toMatchObject({
      role: 'user',
      content: '用户问题 3',
    });
  });

  it('返回 LLM 消息时把压缩摘要作为 system 记忆注入', () => {
    const sessionId = 'memory-test-session';

    for (let i = 1; i <= 6; i++) {
      conversationMemory.appendExchange(sessionId, `用户问题 ${i}`, `助手回答 ${i}`);
    }

    const messages = conversationMemory.getMessages(sessionId);
    expect(messages[0]).toMatchObject({
      role: 'system',
    });
    expect(messages[0].content).toContain('压缩记忆');
    expect(messages).toHaveLength(11);
  });
});
