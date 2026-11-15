/**
 * @file Loan maths. Pure.
 */
import { M } from '../core/dates.js';
import { has, pmt, r2 } from '../core/util.js';

/**
 * Amortisation schedule for one loan. Pure. Returns null when there is nothing to borrow.
 *
 * The short property names of the result are kept because views and backups of older versions rely on them:
 *   P = amount borrowed (principal), need = amount you asked for, fee = opening fee, pay = monthly payment,
 *   f0 = month index of the first payment, sch = schedule rows, by = the same rows by month index,
 *   int = total interest, fees = early-repayment fees, end = month index of the last payment,
 *   baseInt = interest without any extra payments, saved = months saved by extra payments.
 * A schedule row: m = payment number, k = month index, i = interest part, p = principal part,
 *   x = extra payment, fe = fee on that extra payment, pay = regular payment, b = balance after the month.
 *
 * @param {object} loan A normalised loan from the plan.
 */
export function loanCalc(loan) {
  const amountNeeded = loan.amount;
  if (!(amountNeeded > 0)) {
    return null;
  }

  // Opening fee. When the fee is financed, the bank adds it to the loan, and the fee is a percentage of the
  // WHOLE loan (fee included). So the principal is needed / (1 - rate), not needed * (1 + rate).
  // A minimum fee replaces the percentage when the percentage comes out lower.
  const feeRate = loan.feePct / 100;
  let principal = amountNeeded;
  let openingFee;
  if (loan.feeFin) {
    principal = feeRate < 1 ? amountNeeded / (1 - feeRate) : amountNeeded;
    openingFee = principal - amountNeeded;
    if (openingFee < loan.feeMin) {
      openingFee = loan.feeMin;
      principal = amountNeeded + openingFee;
    }
  } else {
    // Fee paid in cash on the day: it does not change what is borrowed.
    openingFee = Math.max(amountNeeded * feeRate, loan.feeMin);
  }

  const monthlyRate = loan.rate / 1200; // yearly percentage to a monthly fraction
  const termMonths = loan.term;
  const monthlyPayment = pmt(principal, monthlyRate, termMonths); // standard annuity formula
  const firstMonth = M.parse(loan.first);
  const schedule = [];
  const rowByMonth = {};
  let balance = principal;
  let totalInterest = 0;
  let earlyFees = 0;

  // One pass per month. The loop also stops as soon as the balance is cleared, which is how extra
  // payments shorten the loan. 0.005 is half a cent: below that the loan counts as paid.
  for (let number = 1; number <= termMonths + 1 && balance > 0.005; number++) {
    const monthIndex = firstMonth + number - 1;
    // Interest is charged on what is still owed; the rest of the fixed payment reduces the balance.
    const interestPart = balance * monthlyRate;
    const principalPart = Math.min(monthlyPayment - interestPart, balance);
    balance -= principalPart;
    totalInterest += interestPart;

    // Extra payment: a specific amount for this month wins over the standing monthly extra.
    const monthKey = M.key(monthIndex);
    const wantedExtra = has(loan.extras, monthKey) ? loan.extras[monthKey] : loan.extra;
    let extraPaid = 0;
    let extraFee = 0;
    if (wantedExtra > 0 && balance > 0.005) {
      extraPaid = Math.min(wantedExtra, balance);
      // Banks charge a higher early-repayment fee while more than 12 months of the loan remain.
      const earlyFeePercent = termMonths - number > 12 ? loan.early1 : loan.early2;
      extraFee = (extraPaid * earlyFeePercent) / 100;
      balance -= extraPaid;
      earlyFees += extraFee;
    }

    const row = {
      m: number,
      k: monthIndex,
      i: interestPart,
      p: principalPart,
      x: extraPaid,
      fe: extraFee,
      pay: principalPart + interestPart,
      b: Math.max(balance, 0),
    };
    schedule.push(row);
    rowByMonth[monthIndex] = row;
  }

  const lastMonth = schedule.length ? schedule[schedule.length - 1].k : firstMonth;
  return {
    P: principal,
    need: amountNeeded,
    fee: openingFee,
    pay: monthlyPayment,
    f0: firstMonth,
    sch: schedule,
    by: rowByMonth,
    int: totalInterest,
    fees: earlyFees,
    end: lastMonth,
    baseInt: monthlyPayment * termMonths - principal,
    saved: termMonths - schedule.length,
    /** Balance still owed at the end of a month: nothing before the loan exists, the full amount in the month before the first payment. */
    balAt: monthIndex => {
      if (monthIndex < firstMonth - 1) {
        return 0;
      }
      if (monthIndex < firstMonth) {
        return principal;
      }
      return rowByMonth[monthIndex] ? rowByMonth[monthIndex].b : 0;
    },
  };
}

/**
 * Debt payoff simulation from month `fromK`: every loan keeps its normal payment, `extra` goes to one target loan at a time
 * ('avalanche' = highest rate first, 'snowball' = smallest balance first) and a finished loan's payment rolls over to the next.
 * Ignores early-repayment fees and per-month extras. Returns { endK, interest, order }.
 */
export function payoffPlan(plan, fromK, extra, strategy) {
  const ls = plan.loans
    .filter(L => L.on)
    .map(L => ({ L, c: loanCalc(L) }))
    .filter(x => x.c && x.c.balAt(fromK - 1) > 0.005)
    .map(x => ({ name: x.L.name, bal: x.c.balAt(fromK - 1), r: x.L.rate / 1200, pay: x.c.pay, rate: x.L.rate }));
  let interest = 0;
  let k = fromK;
  const order = [];
  for (; k < fromK + 720 && ls.some(l => l.bal > 0.005); k++) {
    let pool = extra;
    for (const l of ls) {
      if (l.bal <= 0.005) {
        if (strategy) {
          pool += l.pay;
        }
        continue;
      }
      const i = l.bal * l.r;
      const p = Math.min(l.pay, l.bal + i);
      interest += i;
      l.bal += i - p;
      if (strategy) {
        pool += l.pay - p;
      }
    }
    const open = ls
      .filter(l => l.bal > 0.005)
      .sort((a, b) => (strategy === 'snowball' ? a.bal - b.bal : b.rate - a.rate));
    for (const l of open) {
      if (pool <= 0) {
        break;
      }
      const x = Math.min(pool, l.bal);
      l.bal -= x;
      pool -= x;
    }
    for (const l of ls) {
      if (l.bal <= 0.005 && !order.includes(l.name)) {
        order.push(l.name);
      }
    }
  }
  return { endK: k - 1, interest: r2(interest), order, count: ls.length };
}
