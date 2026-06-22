import { Prisma } from '@prisma/client';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const ZERO = new Prisma.Decimal(0);

export interface DepreciationInput {
  acquisitionCost: number | string | Prisma.Decimal;
  residualValue: number | string | Prisma.Decimal;
  usefulLifeMonths: number;
  method: 'straight_line' | 'declining_balance';
  /** Total depreciation booked so far. */
  accumulatedDepreciation: number | string | Prisma.Decimal;
  /** Number of periods already depreciated (for declining-balance remaining-life). */
  periodsElapsed: number;
}

/**
 * One period's depreciation amount per SRS_05 §2.3 (whole VND).
 *
 * - Straight-line: (cost - residual) / usefulLifeMonths.
 * - Declining-balance: bookValue × annualRate/12, where
 *   annualRate = (1/years) × factor (factor 1.5 for ≤4y, else 2.0), switching
 *   to straight-line-from-here once that yields more (so the asset finishes on
 *   schedule). The result is the larger of the two.
 *
 * In all cases the amount is capped so accumulated depreciation never exceeds
 * the depreciable base (cost - residual); a fully-depreciated asset returns 0.
 */
export function calcPeriodDepreciation(
  input: DepreciationInput,
): Prisma.Decimal {
  const cost = dec(input.acquisitionCost);
  const residual = dec(input.residualValue);
  const accumulated = dec(input.accumulatedDepreciation);
  const depreciableBase = cost.sub(residual);
  if (depreciableBase.lte(0) || input.usefulLifeMonths <= 0) return ZERO;

  const remainingDepreciable = depreciableBase.sub(accumulated);
  if (remainingDepreciable.lte(0)) return ZERO;

  let amount: Prisma.Decimal;
  if (input.method === 'declining_balance') {
    const years = input.usefulLifeMonths / 12;
    const factor = years <= 4 ? 1.5 : 2.0;
    const annualRate = dec(factor).div(years);
    const bookValue = cost.sub(accumulated);
    const monthlyDeclining = bookValue.mul(annualRate).div(12);

    const remainingMonths = Math.max(
      1,
      input.usefulLifeMonths - input.periodsElapsed,
    );
    const straightLineFromHere = bookValue.sub(residual).div(remainingMonths);

    // Switch to straight-line once it would depreciate faster.
    amount = Prisma.Decimal.max(monthlyDeclining, straightLineFromHere);
  } else {
    amount = depreciableBase.div(input.usefulLifeMonths);
  }

  amount = amount.toDecimalPlaces(0);
  // Never depreciate below residual (cap the final period).
  return Prisma.Decimal.min(amount, remainingDepreciable.toDecimalPlaces(0));
}
