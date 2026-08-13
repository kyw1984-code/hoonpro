import type { SourcingProduct } from './types';

export type OpenAiSourcingRequest = {
  keyword: string;
  searchVolume: number;
  growth30d: number;
  avgPrice: number;
  avgReview: number;
  rocketRatio: number;
  adRatio: number;
  estimatedRevenue: number;
  supplierPrice: number;
  score: number;
  grade: string;
};

export type OpenAiSourcingResponse = {
  score: number;
  grade: string;
  recommendation: string;
  reason: string;
  targetCustomers: string[];
  risks: string[];
  differentiation: string[];
  recommendedPrice: Record<string, number>;
  keywords: string[];
};

export function toOpenAiSourcingRequest(product: SourcingProduct): OpenAiSourcingRequest {
  return {
    keyword: product.keyword,
    searchVolume: product.searchVolume,
    growth30d: product.growth30d,
    avgPrice: product.price,
    avgReview: product.avgReview,
    rocketRatio: product.rocketRatio,
    adRatio: product.adRatio,
    estimatedRevenue: product.estimatedRevenue,
    supplierPrice: product.supplierCost,
    score: product.score.total,
    grade: product.grade,
  };
}

export const openAiSourcingJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'number' },
    grade: { type: 'string' },
    recommendation: { type: 'string' },
    reason: { type: 'string' },
    targetCustomers: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    differentiation: { type: 'array', items: { type: 'string' } },
    recommendedPrice: { type: 'object', additionalProperties: { type: 'number' } },
    keywords: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'grade', 'recommendation', 'reason', 'targetCustomers', 'risks', 'differentiation', 'recommendedPrice', 'keywords'],
} as const;
