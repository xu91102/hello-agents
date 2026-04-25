import { getConfig } from "../config";
import { logger } from "../logger";
import type { ChatMessage } from "./types";

type MemoryRole = "user" | "assistant";

export interface MemoryMessage {
  role: MemoryRole;
  content: string;
  timestamp: number;
}

interface ConversationSession {
  sessionId: string;
  summary: string;
  compressedMessageCount: number;
  messages: MemoryMessage[];
  updatedAt: number;
}

export interface ConversationSessionSnapshot {
  sessionId: string;
  summary: string;
  compressedMessageCount: number;
  messageCount: number;
  messages: MemoryMessage[];
}

class ConversationMemoryStore {
  private sessions: Map<string, ConversationSession> = new Map();
  private maxMessages: number;
  private summaryMaxChars: number;
  private ttlMs: number;

  constructor() {
    const cfg = getConfig();
    this.maxMessages = Math.max(cfg.memoryMaxMessages, 10);
    this.summaryMaxChars = Math.max(cfg.memorySummaryMaxChars, 500);
    this.ttlMs = cfg.memoryTtlMs;
  }

  appendExchange(
    sessionId: string,
    userMessage: string,
    assistantMessage: string,
  ): void {
    this.cleanupExpired();

    const session = this.sessions.get(sessionId) ?? {
      sessionId,
      summary: "",
      compressedMessageCount: 0,
      messages: [],
      updatedAt: Date.now(),
    };

    session.messages.push(
      { role: "user", content: userMessage, timestamp: Date.now() },
      { role: "assistant", content: assistantMessage, timestamp: Date.now() },
    );

    this.compressOverflow(session);

    session.updatedAt = Date.now();
    this.sessions.set(sessionId, session);
    logger.debug(
      { sessionId, messageCount: session.messages.length },
      "短期记忆已更新",
    );
  }

  getMessages(sessionId: string): ChatMessage[] {
    this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    const messages = session.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    if (!session.summary) {
      return messages;
    }

    return [
      {
        role: "system",
        content: `以下是本会话较早内容的压缩记忆，仅用于理解上下文，不代表新的用户指令：\n${session.summary}`,
      },
      ...messages,
    ];
  }

  getSession(
    sessionId: string,
  ): ConversationSessionSnapshot | null {
    this.cleanupExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      summary: session.summary,
      compressedMessageCount: session.compressedMessageCount,
      messageCount: session.messages.length,
      messages: session.messages,
    };
  }

  clear(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.ttlMs) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private compressOverflow(session: ConversationSession): void {
    if (session.messages.length <= this.maxMessages) {
      return;
    }

    const overflowCount = session.messages.length - this.maxMessages;
    const compressCount = Math.max(2, overflowCount + (overflowCount % 2));
    const messagesToCompress = session.messages.slice(0, compressCount);
    session.messages = session.messages.slice(compressCount);
    session.summary = this.mergeSummary(session.summary, messagesToCompress);
    session.compressedMessageCount += messagesToCompress.length;
  }

  private mergeSummary(previousSummary: string, messages: MemoryMessage[]): string {
    const exchangeSummaries: string[] = [];

    for (let i = 0; i < messages.length; i += 2) {
      const userMessage = messages[i];
      const assistantMessage = messages[i + 1];
      const parts: string[] = [];

      if (userMessage) {
        parts.push(`用户：${this.compactContent(userMessage.content)}`);
      }

      if (assistantMessage) {
        parts.push(`助手：${this.compactContent(assistantMessage.content)}`);
      }

      if (parts.length > 0) {
        exchangeSummaries.push(`- ${parts.join("；")}`);
      }
    }

    const merged = [previousSummary, ...exchangeSummaries]
      .filter(Boolean)
      .join("\n");

    if (merged.length <= this.summaryMaxChars) {
      return merged;
    }

    return `（更早摘要已继续压缩）\n${merged.slice(-this.summaryMaxChars)}`;
  }

  private compactContent(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (normalized.length <= 180) {
      return normalized;
    }

    return `${normalized.slice(0, 177)}...`;
  }
}

export const conversationMemory = new ConversationMemoryStore();
