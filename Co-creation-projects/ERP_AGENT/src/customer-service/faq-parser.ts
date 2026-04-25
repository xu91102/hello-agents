import path from 'path';
import mammoth from 'mammoth';

export interface CustomerServiceFaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  sourceDoc: string;
  sourceSection: string;
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isCategoryLine(line: string): boolean {
  return /^[一二三四五六七八九十]+、/.test(line) && !/^[一二三四五六七八九十]+、问[：:]/.test(line);
}

function isReplyLine(line: string): boolean {
  return /^回复[：:]/.test(line);
}

function isNumberedQuestion(line: string): boolean {
  return /^(\d+([-.、]|-\d+、?)|[一二三四五六七八九十]+、问[：:])/.test(line);
}

function stripQuestionPrefix(line: string): string {
  return line
    .replace(/^\d+(-\d+)?[、.]\s*/, '')
    .replace(/^[一二三四五六七八九十]+、问[：:]\s*/, '')
    .replace(/^问[：:]\s*/, '')
    .trim();
}

function stripReplyPrefix(line: string): string {
  return line.replace(/^回复[：:]\s*/, '').trim();
}

function splitInlineReply(line: string): { questionLine: string; answerLine?: string } {
  const match = line.match(/回复[：:]/);
  if (!match || match.index == null || match.index <= 0) {
    return { questionLine: line };
  }

  return {
    questionLine: line.slice(0, match.index).trim(),
    answerLine: stripReplyPrefix(line.slice(match.index).trim()),
  };
}

function buildId(index: number): string {
  return `faq-${String(index + 1).padStart(4, '0')}`;
}

export async function extractTextFromDocx(docxPath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: docxPath });
  return result.value;
}

export function parseCustomerServiceFaqText(
  rawText: string,
  sourceDoc: string,
): CustomerServiceFaqItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

  const items: CustomerServiceFaqItem[] = [];
  let currentCategory = '未分类';
  let currentQuestion: string | null = null;
  let currentAnswerLines: string[] = [];

  const flush = (): void => {
    if (!currentQuestion || currentAnswerLines.length === 0) {
      currentAnswerLines = [];
      return;
    }

    const answer = currentAnswerLines.join('\n').trim();
    if (!answer) {
      currentAnswerLines = [];
      return;
    }

    items.push({
      id: buildId(items.length),
      category: currentCategory,
      question: currentQuestion,
      answer,
      sourceDoc: path.basename(sourceDoc),
      sourceSection: currentCategory,
    });
    currentAnswerLines = [];
  };

  for (const line of lines) {
    if (isCategoryLine(line)) {
      flush();
      currentCategory = line.replace(/[：:]$/, '').trim();
      currentQuestion = null;
      continue;
    }

    if (isReplyLine(line)) {
      currentAnswerLines.push(stripReplyPrefix(line));
      continue;
    }

    if (isNumberedQuestion(line) || (line.includes('？') && currentAnswerLines.length > 0)) {
      const { questionLine, answerLine } = splitInlineReply(line);
      flush();
      currentQuestion = stripQuestionPrefix(questionLine);
      if (answerLine) {
        currentAnswerLines.push(answerLine);
      }
      continue;
    }

    if (!currentQuestion && line.includes('？')) {
      currentQuestion = stripQuestionPrefix(line);
      continue;
    }

    if (currentQuestion) {
      currentAnswerLines.push(line);
    }
  }

  flush();
  return items;
}

export async function loadCustomerServiceFaq(docxPath: string): Promise<CustomerServiceFaqItem[]> {
  const rawText = await extractTextFromDocx(docxPath);
  return parseCustomerServiceFaqText(rawText, docxPath);
}
