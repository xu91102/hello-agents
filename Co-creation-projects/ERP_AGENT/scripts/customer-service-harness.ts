import fs from 'fs/promises';
import path from 'path';
import { classifyIntent } from '../src/customer-service/intent-classifier';
import { customerServiceRag } from '../src/customer-service/rag-service';

interface FaqCase {
  message: string;
  expectedQuestionIncludes: string;
  expectedKeywords: string[];
  expectNeedsHuman: boolean;
}

interface IntentCase {
  message: string;
  expectedIntent: string;
}

interface HarnessMetrics {
  intent_accuracy: number;
  retrieval_hit_rate_at_3: number;
  answer_keyword_pass_rate: number;
  unknown_rejection_rate: number;
}

const THRESHOLDS = {
  intent_accuracy: 0.85,
  retrieval_hit_rate_at_3: 0.85,
  answer_keyword_pass_rate: 0.85,
  unknown_rejection_rate: 0.9,
};

async function readJson<T>(filePath: string): Promise<T> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text) as T;
}

function ratio(passed: number, total: number): number {
  return total === 0 ? 1 : passed / total;
}

async function main(): Promise<void> {
  const baseDir = path.resolve(process.cwd(), 'harness', 'customer-service');
  const faqCases = await readJson<FaqCase[]>(path.join(baseDir, 'faq-cases.json'));
  const intentCases = await readJson<IntentCase[]>(path.join(baseDir, 'intent-cases.json'));

  let intentPassed = 0;
  for (const testCase of intentCases) {
    const actual = classifyIntent(testCase.message).intent;
    if (actual === testCase.expectedIntent) {
      intentPassed++;
    }
  }

  let retrievalPassed = 0;
  let keywordPassed = 0;
  let unknownPassed = 0;
  let unknownTotal = 0;
  const answerCases = faqCases.filter((testCase) => !testCase.expectNeedsHuman);

  for (const testCase of faqCases) {
    const answer = await customerServiceRag.answer(testCase.message);

    if (testCase.expectNeedsHuman) {
      unknownTotal++;
      if (answer.needsHuman || classifyIntent(testCase.message).intent === 'unknown') {
        unknownPassed++;
      }
      continue;
    }

    if (answer.retrievalHits.some((hit) => hit.question.includes(testCase.expectedQuestionIncludes))) {
      retrievalPassed++;
    }

    if (testCase.expectedKeywords.every((keyword) => answer.answer.includes(keyword))) {
      keywordPassed++;
    }
  }

  const metrics: HarnessMetrics = {
    intent_accuracy: ratio(intentPassed, intentCases.length),
    retrieval_hit_rate_at_3: ratio(retrievalPassed, answerCases.length),
    answer_keyword_pass_rate: ratio(keywordPassed, answerCases.length),
    unknown_rejection_rate: ratio(unknownPassed, unknownTotal),
  };

  process.stdout.write(JSON.stringify({ metrics, thresholds: THRESHOLDS }, null, 2) + '\n');

  const failed = Object.entries(THRESHOLDS).filter(([key, threshold]) => {
    return metrics[key as keyof HarnessMetrics] < threshold;
  });

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`客服 harness 执行失败: ${message}\n`);
  process.exit(1);
});
