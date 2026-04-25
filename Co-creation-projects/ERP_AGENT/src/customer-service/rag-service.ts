import fs from 'fs/promises';
import path from 'path';
import { Document, Settings, VectorStoreIndex, storageContextFromDefaults } from 'llamaindex';
import { getConfig } from '../config';
import { logger } from '../logger';
import { CustomerServiceFaqItem, loadCustomerServiceFaq } from './faq-parser';
import { LocalHashEmbedding } from './hash-embedding';

export interface CustomerServiceRetrievalHit {
  id: string;
  category: string;
  question: string;
  answer: string;
  score: number;
  sourceDoc: string;
  sourceSection: string;
}

export interface CustomerServiceAnswer {
  answer: string;
  matchedCategory?: string;
  retrievalHits: CustomerServiceRetrievalHit[];
  confidence: number;
  needsHuman: boolean;
}

function faqToText(item: CustomerServiceFaqItem): string {
  return `分类：${item.category}\n问题：${item.question}\n回复：${item.answer}`;
}

function tokenizeForRank(text: string): string[] {
  const normalized = text.toLowerCase();
  const latinTokens = normalized.match(/[a-z0-9_-]+/g) ?? [];
  const chineseTokens = normalized.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const businessTokens = [
    '服务费',
    '退款',
    '企微',
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
    '协议',
    '小程序',
    'app',
    '支付',
  ].filter((token) => normalized.includes(token.toLowerCase()));

  return Array.from(new Set([...latinTokens, ...chineseTokens, ...businessTokens]));
}

function rankHits(message: string, hits: CustomerServiceRetrievalHit[]): CustomerServiceRetrievalHit[] {
  const queryTokens = tokenizeForRank(message);
  const seen = new Set<string>();

  return hits
    .map((hit) => {
      const target = `${hit.category} ${hit.question} ${hit.answer}`.toLowerCase();
      const overlap = queryTokens.filter((token) => target.includes(token.toLowerCase())).length;
      const actionBoost =
        message.includes('充值') && /充值|支付|银行卡|云闪付/.test(`${hit.question} ${hit.answer}`)
          ? 0.08
          : 0;

      return { ...hit, score: hit.score + overlap * 0.08 + actionBoost };
    })
    .sort((a, b) => b.score - a.score)
    .filter((hit) => {
      if (seen.has(hit.id)) {
        return false;
      }

      seen.add(hit.id);
      return true;
    });
}

function toHit(nodeWithScore: {
  node: { metadata: Record<string, unknown> };
  score?: number;
}): CustomerServiceRetrievalHit {
  const metadata = nodeWithScore.node.metadata;
  return {
    id: String(metadata['id'] ?? ''),
    category: String(metadata['category'] ?? ''),
    question: String(metadata['question'] ?? ''),
    answer: String(metadata['answer'] ?? ''),
    score: nodeWithScore.score ?? 0,
    sourceDoc: String(metadata['sourceDoc'] ?? ''),
    sourceSection: String(metadata['sourceSection'] ?? ''),
  };
}

export class CustomerServiceRagService {
  private index: VectorStoreIndex | null = null;
  private faqItems: CustomerServiceFaqItem[] = [];
  private readonly embedding = new LocalHashEmbedding();

  async answer(message: string): Promise<CustomerServiceAnswer> {
    const cfg = getConfig();
    const hits = await this.retrieve(message, cfg.ragTopK);
    const acceptedHits = hits.filter((hit) => hit.score >= cfg.ragMinScore);

    if (acceptedHits.length === 0) {
      return {
        answer: '这个问题我暂时没有在客服标准话术中找到准确答案，建议转人工客服确认后再回复。',
        retrievalHits: hits,
        confidence: hits[0]?.score ?? 0,
        needsHuman: true,
      };
    }

    const best = acceptedHits[0];
    return {
      answer: best.answer,
      matchedCategory: best.category,
      retrievalHits: hits,
      confidence: best.score,
      needsHuman: false,
    };
  }

  async retrieve(message: string, topK = getConfig().ragTopK): Promise<CustomerServiceRetrievalHit[]> {
    await this.ensureIndex();
    if (!this.index) {
      return [];
    }

    const retriever = this.index.asRetriever({ similarityTopK: Math.max(topK, 8) });
    const nodes = await retriever.retrieve({ query: message });
    return rankHits(message, nodes.map(toHit)).slice(0, topK);
  }

  async loadFaqItems(): Promise<CustomerServiceFaqItem[]> {
    await this.ensureIndex();
    return this.faqItems;
  }

  private async ensureIndex(): Promise<void> {
    if (this.index) {
      return;
    }

    const cfg = getConfig();
    Settings.embedModel = this.embedding;
    await fs.rm(cfg.ragStorageDir, { recursive: true, force: true });
    await fs.mkdir(cfg.ragStorageDir, { recursive: true });

    this.faqItems = await loadCustomerServiceFaq(cfg.customerServiceDocxPath);
    const documents = this.faqItems.map((item) => new Document({
      text: faqToText(item),
      metadata: {
        id: item.id,
        category: item.category,
        question: item.question,
        answer: item.answer,
        sourceDoc: item.sourceDoc,
        sourceSection: item.sourceSection,
      },
    }));

    const storageContext = await storageContextFromDefaults({ persistDir: cfg.ragStorageDir });
    this.index = await VectorStoreIndex.fromDocuments(documents, { storageContext });
    await this.persistIndex();
    logger.info({
      faqCount: this.faqItems.length,
      ragStorageDir: cfg.ragStorageDir,
      embeddingModel: cfg.ragEmbeddingModel,
    }, 'AI 客服 RAG 知识库已加载');
  }

  private async persistIndex(): Promise<void> {
    const cfg = getConfig();
    const vectorStores = this.index?.vectorStores as unknown as Record<string, unknown> | undefined;
    const vectorStore = vectorStores ? Object.values(vectorStores)[0] : undefined;
    const persistable = vectorStore as { persist?: (persistPath?: string) => Promise<void> } | undefined;
    await persistable?.persist?.(path.join(cfg.ragStorageDir, 'vector_store.json'));
  }
}

export const customerServiceRag = new CustomerServiceRagService();
