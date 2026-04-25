import { BaseEmbedding } from 'llamaindex';

const DEFAULT_DIMENSIONS = 256;

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latinTokens = normalized.match(/[a-z0-9_-]+/g) ?? [];
  const chineseTokens = normalized.match(/[\u4e00-\u9fa5]/g) ?? [];
  const bigrams: string[] = [];

  for (let index = 0; index < chineseTokens.length - 1; index++) {
    bigrams.push(`${chineseTokens[index]}${chineseTokens[index + 1]}`);
  }

  return [...latinTokens, ...chineseTokens, ...bigrams];
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index++) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export class LocalHashEmbedding extends BaseEmbedding {
  private readonly dimensions: number;

  constructor(dimensions = DEFAULT_DIMENSIONS) {
    super();
    this.dimensions = dimensions;
    this.embedInfo = { dimensions };
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    const vector = Array(this.dimensions).fill(0) as number[];
    const tokens = tokenize(text);

    for (const token of tokens) {
      const hash = hashToken(token);
      const index = hash % this.dimensions;
      vector[index] += (hash & 1) === 0 ? 1 : -1;
    }

    const norm = Math.hypot(...vector);
    return norm === 0 ? vector : vector.map((value) => value / norm);
  }
}
