import { Prisma } from '@prisma/client';
import { calcPayroll, calcPIT, VN_PAYROLL } from './payroll-calc.js';

const n = (d: Prisma.Decimal) => d.toNumber();

describe('calcPIT (progressive VN brackets)', () => {
  it('is zero for non-positive taxable income', () => {
    expect(n(calcPIT(new Prisma.Decimal(0)))).toBe(0);
    expect(n(calcPIT(new Prisma.Decimal(-100)))).toBe(0);
  });

  it('taxes within the first 5% bracket', () => {
    // 4,000,000 → 5%
    expect(n(calcPIT(new Prisma.Decimal(4_000_000)))).toBe(200_000);
  });

  it('applies progressive bands across brackets', () => {
    // 20,000,000 taxable:
    //  5M*5% =250k; next 5M*10% =500k; next 8M*15% =1,200k; next 2M*20% =400k
    //  total = 2,350,000
    expect(n(calcPIT(new Prisma.Decimal(20_000_000)))).toBe(2_350_000);
  });

  it('reaches the top 35% band for very high income', () => {
    // 100,000,000 taxable:
    //  250k + 500k + 1,200k + 2,800k(14M*20%) + 5,000k(20M*25%)
    //  + 8,400k(28M*30%) + 7,000k(20M*35%) = 25,150,000
    expect(n(calcPIT(new Prisma.Decimal(100_000_000)))).toBe(25_150_000);
  });
});

describe('calcPayroll (VN statutory)', () => {
  it('computes gross, insurance, taxable, PIT, net and employer cost', () => {
    const r = calcPayroll({
      basicSalary: 20_000_000,
      allowances: 2_000_000,
      numberOfDependents: 1,
    });

    expect(n(r.grossSalary)).toBe(22_000_000);

    // base = min(20M, 36M) = 20M
    expect(n(r.empBHXH)).toBe(1_600_000); // 8%
    expect(n(r.empBHYT)).toBe(300_000); // 1.5%
    expect(n(r.empBHTN)).toBe(200_000); // 1% of min(20M, 20*4.68M)

    // taxable = 22M - 2.1M ins - 11M personal - 4.4M dependent = 4,500,000
    expect(n(r.taxableIncome)).toBe(4_500_000);
    // PIT @5% = 225,000
    expect(n(r.pitAmount)).toBe(225_000);
    // net = 22M - 2.1M - 225k = 19,675,000
    expect(n(r.netSalary)).toBe(19_675_000);

    // employer: 17.5 + 3 + 1 = 21.5% of 20M = 4,300,000
    expect(n(r.emplrBHXH)).toBe(3_500_000);
    expect(n(r.emplrBHYT)).toBe(600_000);
    expect(n(r.emplrBHTN)).toBe(200_000);
    expect(n(r.totalCostToCompany)).toBe(22_000_000 + 4_300_000);
  });

  it('caps the BHXH/BHYT base at 20× base salary (36,000,000)', () => {
    const r = calcPayroll({ basicSalary: 50_000_000, numberOfDependents: 0 });
    // base capped at 36M → BHXH 8% = 2,880,000
    expect(n(r.empBHXH)).toBe(Math.round(VN_PAYROLL.bhxhBaseCap * 0.08));
    expect(n(r.empBHXH)).toBe(2_880_000);
  });

  it('never produces negative taxable income for low earners', () => {
    const r = calcPayroll({ basicSalary: 5_000_000, numberOfDependents: 0 });
    expect(n(r.taxableIncome)).toBe(0);
    expect(n(r.pitAmount)).toBe(0);
  });

  it('the auto-journal identity holds: gross + emplrIns = net + allIns + pit', () => {
    const r = calcPayroll({
      basicSalary: 30_000_000,
      bonuses: 5_000_000,
      numberOfDependents: 2,
    });
    const empIns = r.empBHXH.add(r.empBHYT).add(r.empBHTN);
    const emplrIns = r.emplrBHXH.add(r.emplrBHYT).add(r.emplrBHTN);
    const debit = r.grossSalary.add(emplrIns);
    const credit = r.netSalary.add(empIns).add(emplrIns).add(r.pitAmount);
    expect(n(debit)).toBe(n(credit));
  });
});
