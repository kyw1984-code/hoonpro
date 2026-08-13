import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCompetitionScore,
  calculateDemandScore,
  calculateGrowthScore,
  calculateMarginScore,
  calculateProductScore,
  calculateReviewScore,
} from './calculateProductScore';

test('AI SCORE component thresholds follow the PRD scoring table', () => {
  assert.equal(calculateDemandScore(82400), 20);
  assert.equal(calculateCompetitionScore(18), 20);
  assert.equal(calculateReviewScore(82), 10);
  assert.equal(calculateGrowthScore(67), 15);
  assert.equal(calculateMarginScore(40), 15);
});

test('AI SCORE total is 100-point grade result from input data', () => {
  const result = calculateProductScore({
    searchVolume: 82400,
    competitionLevel: 18,
    avgReview: 82,
    growth30d: 67,
    expectedMargin: 40,
    priceStability: 5,
    seasonality: 5,
    supplierReliability: 5,
  });

  assert.equal(result.total, 95);
  assert.equal(result.grade, 'S');
  assert.equal(result.recommendation, '적극 검토');
});
