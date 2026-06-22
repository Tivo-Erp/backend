import { Prisma } from '@prisma/client';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

/**
 * Vietnam payroll constants (2024/2025 statutory values). Centralised so a
 * future ConfigService / effective-dated table can replace them without
 * touching the formula. Amounts in VND.
 */
export const VN_PAYROLL = {
  /** Social-insurance contribution base cap = 20 × base salary (1,800,000). */
  bhxhBaseCap: 20 * 1_800_000, // 36,000,000
  /** Regional minimum wage (Region I). Unemployment-insurance base cap = 20×. */
  minWageRegion: 4_680_000,
  personalDeduction: 11_000_000,
  dependentDeduction: 4_400_000,
  rates: {
    empBHXH: 0.08,
    empBHYT: 0.015,
    empBHTN: 0.01,
    emplrBHXH: 0.175,
    emplrBHYT: 0.03,
    emplrBHTN: 0.01,
  },
} as const;

/** Monthly progressive PIT brackets: [upperBoundExclusive, rate]. */
const PIT_BRACKETS: Array<[number, number]> = [
  [5_000_000, 0.05],
  [10_000_000, 0.1],
  [18_000_000, 0.15],
  [32_000_000, 0.2],
  [52_000_000, 0.25],
  [80_000_000, 0.3],
  [Infinity, 0.35],
];

/** Progressive PIT on a (non-negative) monthly taxable income. */
export function calcPIT(taxableIncome: Prisma.Decimal): Prisma.Decimal {
  let remaining = taxableIncome;
  if (remaining.lte(0)) return dec(0);
  let tax = dec(0);
  let lower = 0;
  for (const [upper, rate] of PIT_BRACKETS) {
    const bandWidth = dec(
      upper === Infinity ? Number.MAX_SAFE_INTEGER : upper,
    ).sub(dec(lower));
    const amountInBand = Prisma.Decimal.min(remaining, bandWidth);
    tax = tax.add(amountInBand.mul(rate));
    remaining = remaining.sub(amountInBand);
    lower = upper;
    if (remaining.lte(0)) break;
  }
  return tax.toDecimalPlaces(0);
}

export interface PayrollInput {
  basicSalary: number | Prisma.Decimal;
  allowances?: number | Prisma.Decimal;
  overtime?: number | Prisma.Decimal;
  bonuses?: number | Prisma.Decimal;
  numberOfDependents: number;
}

export interface PayrollResult {
  basicSalary: Prisma.Decimal;
  allowances: Prisma.Decimal;
  overtime: Prisma.Decimal;
  bonuses: Prisma.Decimal;
  grossSalary: Prisma.Decimal;
  empBHXH: Prisma.Decimal;
  empBHYT: Prisma.Decimal;
  empBHTN: Prisma.Decimal;
  personalDeduction: Prisma.Decimal;
  dependentDeduction: Prisma.Decimal;
  taxableIncome: Prisma.Decimal;
  pitAmount: Prisma.Decimal;
  netSalary: Prisma.Decimal;
  emplrBHXH: Prisma.Decimal;
  emplrBHYT: Prisma.Decimal;
  emplrBHTN: Prisma.Decimal;
  totalCostToCompany: Prisma.Decimal;
}

/**
 * Computes a single employee's payroll line per the VN statutory formula.
 * All money is `Prisma.Decimal`; insurance/PIT rounded to whole VND.
 */
export function calcPayroll(input: PayrollInput): PayrollResult {
  const basicSalary = dec(input.basicSalary);
  const allowances = dec(input.allowances ?? 0);
  const overtime = dec(input.overtime ?? 0);
  const bonuses = dec(input.bonuses ?? 0);

  const grossSalary = basicSalary.add(allowances).add(overtime).add(bonuses);

  const bhxhBase = Prisma.Decimal.min(basicSalary, dec(VN_PAYROLL.bhxhBaseCap));
  const btnBase = Prisma.Decimal.min(
    basicSalary,
    dec(20 * VN_PAYROLL.minWageRegion),
  );

  const empBHXH = bhxhBase.mul(VN_PAYROLL.rates.empBHXH).toDecimalPlaces(0);
  const empBHYT = bhxhBase.mul(VN_PAYROLL.rates.empBHYT).toDecimalPlaces(0);
  const empBHTN = btnBase.mul(VN_PAYROLL.rates.empBHTN).toDecimalPlaces(0);

  const personalDeduction = dec(VN_PAYROLL.personalDeduction);
  const dependentDeduction = dec(VN_PAYROLL.dependentDeduction).mul(
    Math.max(0, input.numberOfDependents),
  );

  const taxableIncome = Prisma.Decimal.max(
    dec(0),
    grossSalary
      .sub(empBHXH)
      .sub(empBHYT)
      .sub(empBHTN)
      .sub(personalDeduction)
      .sub(dependentDeduction),
  );

  const pitAmount = calcPIT(taxableIncome);

  const netSalary = grossSalary
    .sub(empBHXH)
    .sub(empBHYT)
    .sub(empBHTN)
    .sub(pitAmount);

  const emplrBHXH = bhxhBase.mul(VN_PAYROLL.rates.emplrBHXH).toDecimalPlaces(0);
  const emplrBHYT = bhxhBase.mul(VN_PAYROLL.rates.emplrBHYT).toDecimalPlaces(0);
  const emplrBHTN = btnBase.mul(VN_PAYROLL.rates.emplrBHTN).toDecimalPlaces(0);

  const totalCostToCompany = grossSalary
    .add(emplrBHXH)
    .add(emplrBHYT)
    .add(emplrBHTN);

  return {
    basicSalary,
    allowances,
    overtime,
    bonuses,
    grossSalary,
    empBHXH,
    empBHYT,
    empBHTN,
    personalDeduction,
    dependentDeduction,
    taxableIncome,
    pitAmount,
    netSalary,
    emplrBHXH,
    emplrBHYT,
    emplrBHTN,
    totalCostToCompany,
  };
}
