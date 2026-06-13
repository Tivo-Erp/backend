import { Prisma } from '@prisma/client';
import { calcPeriodDepreciation } from './asset-depreciation-calc.js';

const n = (d: Prisma.Decimal) => d.toNumber();

describe('calcPeriodDepreciation', () => {
  it('straight-line: (cost - residual) / usefulLifeMonths', () => {
    const amt = calcPeriodDepreciation({
      acquisitionCost: 120_000_000,
      residualValue: 12_000_000,
      usefulLifeMonths: 60,
      method: 'straight_line',
      accumulatedDepreciation: 0,
      periodsElapsed: 0,
    });
    expect(n(amt)).toBe(1_800_000); // 108,000,000 / 60
  });

  it('caps the final straight-line period so it never passes the depreciable base', () => {
    // Almost fully depreciated: only 500,000 of depreciable base remains.
    const amt = calcPeriodDepreciation({
      acquisitionCost: 120_000_000,
      residualValue: 12_000_000,
      usefulLifeMonths: 60,
      method: 'straight_line',
      accumulatedDepreciation: 107_500_000,
      periodsElapsed: 59,
    });
    expect(n(amt)).toBe(500_000);
  });

  it('returns 0 when fully depreciated', () => {
    const amt = calcPeriodDepreciation({
      acquisitionCost: 120_000_000,
      residualValue: 12_000_000,
      usefulLifeMonths: 60,
      method: 'straight_line',
      accumulatedDepreciation: 108_000_000,
      periodsElapsed: 60,
    });
    expect(n(amt)).toBe(0);
  });

  it('declining-balance first period uses bookValue × rate/12 (factor 2.0 for >4y)', () => {
    // years = 5 → factor 2.0 → annualRate 0.4 → monthly = 120M × 0.4 / 12 = 4,000,000
    const amt = calcPeriodDepreciation({
      acquisitionCost: 120_000_000,
      residualValue: 12_000_000,
      usefulLifeMonths: 60,
      method: 'declining_balance',
      accumulatedDepreciation: 0,
      periodsElapsed: 0,
    });
    expect(n(amt)).toBe(4_000_000);
  });

  it('declining-balance switches to straight-line near end of life', () => {
    // Late in life with little book value left, straight-line-from-here exceeds
    // the declining amount, so the larger (straight-line) figure is used.
    const amt = calcPeriodDepreciation({
      acquisitionCost: 120_000_000,
      residualValue: 12_000_000,
      usefulLifeMonths: 60,
      method: 'declining_balance',
      accumulatedDepreciation: 100_000_000,
      periodsElapsed: 58, // 2 months left
    });
    // bookValue 20M; declining monthly = 20M×0.4/12 ≈ 666,667;
    // straight-line-from-here = (20M - 12M) / 2 = 4,000,000 → switch wins.
    expect(n(amt)).toBe(4_000_000);
  });
});
