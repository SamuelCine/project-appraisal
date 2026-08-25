export interface DatedCashFlow {
  amount: number;
  date: string | Date;
}

function assertRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= -1) {
    throw new Error("折现率必须大于 -100%");
  }
}

function assertCashFlows(cashFlows: number[]) {
  if (cashFlows.length < 2 || cashFlows.some((value) => !Number.isFinite(value))) {
    throw new Error("至少需要两期有效现金流");
  }
}

export function npv(rate: number, cashFlows: number[]) {
  assertRate(rate);
  assertCashFlows(cashFlows);
  return cashFlows.reduce((total, amount, period) => total + amount / (1 + rate) ** period, 0);
}

function dayDistance(from: Date, to: Date) {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

export function xnpv(rate: number, cashFlows: DatedCashFlow[]) {
  assertRate(rate);
  if (cashFlows.length < 2) throw new Error("至少需要两笔有效现金流");
  const normalized = cashFlows
    .map(({ amount, date }) => ({ amount, date: new Date(date) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (normalized.some(({ amount, date }) => !Number.isFinite(amount) || Number.isNaN(date.getTime()))) {
    throw new Error("现金流日期或金额无效");
  }
  const first = normalized[0].date;
  return normalized.reduce(
    (total, item) => total + item.amount / (1 + rate) ** (dayDistance(first, item.date) / 365),
    0,
  );
}

function rateGrid() {
  const values = [-0.9999, -0.99, -0.95, -0.9, -0.75, -0.5, -0.25, 0];
  for (let rate = 0.01; rate <= 1; rate += 0.01) values.push(rate);
  for (let rate = 1.1; rate <= 10; rate += 0.1) values.push(rate);
  for (let rate = 11; rate <= 100; rate += 1) values.push(rate);
  return values;
}

function solveRate(valueAt: (rate: number) => number) {
  const grid = rateGrid();
  let left = grid[0];
  let leftValue = valueAt(left);
  for (const right of grid.slice(1)) {
    const rightValue = valueAt(right);
    if (Math.abs(rightValue) < 1e-10) return right;
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue * rightValue < 0) {
      let low = left;
      let high = right;
      let lowValue = leftValue;
      for (let iteration = 0; iteration < 160; iteration += 1) {
        const middle = (low + high) / 2;
        const middleValue = valueAt(middle);
        if (Math.abs(middleValue) < 1e-10) return middle;
        if (lowValue * middleValue <= 0) {
          high = middle;
        } else {
          low = middle;
          lowValue = middleValue;
        }
      }
      return (low + high) / 2;
    }
    left = right;
    leftValue = rightValue;
  }
  return null;
}

export function irr(cashFlows: number[]) {
  assertCashFlows(cashFlows);
  if (!cashFlows.some((value) => value < 0) || !cashFlows.some((value) => value > 0)) return null;
  return solveRate((rate) => npv(rate, cashFlows));
}

export function xirr(cashFlows: DatedCashFlow[]) {
  if (!cashFlows.some(({ amount }) => amount < 0) || !cashFlows.some(({ amount }) => amount > 0)) return null;
  return solveRate((rate) => xnpv(rate, cashFlows));
}

export function mirr(cashFlows: number[], financeRate: number, reinvestmentRate: number) {
  assertRate(financeRate);
  assertRate(reinvestmentRate);
  assertCashFlows(cashFlows);
  const finalPeriod = cashFlows.length - 1;
  const outflows = cashFlows.reduce(
    (total, amount, period) => total + (amount < 0 ? -amount / (1 + financeRate) ** period : 0),
    0,
  );
  const inflows = cashFlows.reduce(
    (total, amount, period) => total + (amount > 0 ? amount * (1 + reinvestmentRate) ** (finalPeriod - period) : 0),
    0,
  );
  if (outflows === 0 || inflows === 0) return null;
  return (inflows / outflows) ** (1 / finalPeriod) - 1;
}

function payback(cashFlows: number[], rate?: number) {
  assertCashFlows(cashFlows);
  let cumulative = cashFlows[0];
  if (cumulative >= 0) return 0;
  for (let period = 1; period < cashFlows.length; period += 1) {
    const flow = rate === undefined ? cashFlows[period] : cashFlows[period] / (1 + rate) ** period;
    const before = cumulative;
    cumulative += flow;
    if (cumulative >= 0 && flow > 0) return period - 1 + -before / flow;
  }
  return null;
}

export function paybackPeriod(cashFlows: number[]) {
  return payback(cashFlows);
}

export function discountedPaybackPeriod(rate: number, cashFlows: number[]) {
  assertRate(rate);
  return payback(cashFlows, rate);
}

export function profitabilityIndex(rate: number, cashFlows: number[]) {
  assertRate(rate);
  assertCashFlows(cashFlows);
  const inflows = cashFlows.reduce(
    (total, amount, period) => total + (amount > 0 ? amount / (1 + rate) ** period : 0),
    0,
  );
  const outflows = cashFlows.reduce(
    (total, amount, period) => total + (amount < 0 ? -amount / (1 + rate) ** period : 0),
    0,
  );
  return outflows === 0 ? Number.POSITIVE_INFINITY : inflows / outflows;
}

export function breakEven(fixedCosts: number, variableCostPerUnit: number, pricePerUnit: number) {
  if (fixedCosts < 0 || variableCostPerUnit < 0 || pricePerUnit <= 0) throw new Error("成本和售价必须为有效正数");
  if (pricePerUnit <= variableCostPerUnit) throw new Error("售价必须高于单位变动成本");
  const units = fixedCosts / (pricePerUnit - variableCostPerUnit);
  return { units, revenue: units * pricePerUnit };
}

export function signChanges(cashFlows: number[]) {
  const signs = cashFlows.filter((value) => value !== 0).map((value) => Math.sign(value));
  return signs.slice(1).reduce((count, sign, index) => count + (sign !== signs[index] ? 1 : 0), 0);
}
