(function () {
  "use strict";

  const core = window.FinanceCore;
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const nowIso = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const text = value => String(value || "").trim();

  function normalize(ledger) {
    ["loans", "goals", "annualPlans", "auditJournal"].forEach(key => { if (!Array.isArray(ledger[key])) ledger[key] = []; });
    (ledger.accounts || []).forEach(row => { row.archived = Boolean(row.archived); });
    return ledger;
  }

  function commit(reason, mutate) {
    const { ledger, assets } = core.load();
    normalize(ledger);
    const result = mutate(ledger, assets);
    core.persist(ledger, assets, reason);
    return result;
  }

  function accountSignature(row) {
    return [row.date, row.type, Number(row.transactionAmount ?? row.amount).toFixed(2), row.account, row.merchant, row.category, row.item].join("|");
  }

  function audit(bundle = core.insights()) {
    const { ledger, assets, assetsSummary, stockPositions } = bundle;
    normalize(ledger);
    const issues = [];
    const accountNames = new Set((ledger.accounts || []).map(row => row.name));
    const duplicateGroups = new Map();
    (ledger.entries || []).filter(row => !row.isForeignTransactionFee).forEach(row => {
      const signature = accountSignature(row);
      const rows = duplicateGroups.get(signature) || [];
      rows.push(row);
      duplicateGroups.set(signature, rows);
    });
    [...duplicateGroups.values()].filter(rows => rows.length > 1).forEach(rows => issues.push({ id:`duplicate:${rows[0].id}`, level:"warning", title:"疑似重複收支", detail:`${rows[0].date}｜${rows[0].merchant || rows[0].category}｜${rows.length} 筆相同資料`, route:"daily/records" }));
    (ledger.entries || []).filter(row => row.account && !accountNames.has(row.account)).forEach(row => issues.push({ id:`orphan-entry:${row.id}`, level:"danger", title:"收支連結到不存在的帳戶", detail:`${row.date}｜${row.account}｜${row.merchant || row.category}`, route:"daily/records" }));
    (ledger.transfers || []).filter(row => !accountNames.has(row.fromAccount) || !accountNames.has(row.toAccount)).forEach(row => issues.push({ id:`orphan-transfer:${row.id}`, level:"danger", title:"轉帳帳戶連結失效", detail:`${row.fromAccount || "未指定"} → ${row.toAccount || "未指定"}`, route:"accounts/transfer" }));
    (assetsSummary.accounts || []).filter(row => row.type !== "信用卡" && number(row.twdBalance) < 0).forEach(row => issues.push({ id:`negative:${row.id}`, level:"danger", title:`${row.name} 餘額為負`, detail:`目前約 NT$ ${Math.round(number(row.twdBalance)).toLocaleString("zh-TW")}`, route:"accounts/accounts" }));
    (stockPositions?.discrepancies || []).forEach(row => issues.push({ id:`holding:${row.key}`, level:row.oversold?"danger":"warning", title:`${row.code || row.name} 持倉需要核對`, detail:row.oversold?"賣出數量超過累計買入":"交易股數與舊持倉不一致", route:"investments/holdings" }));
    (ledger.creditStatementChecks || []).filter(row => Math.abs(number(row.diff)) >= 1).forEach(row => issues.push({ id:`statement:${row.id}`, level:"warning", title:`${row.card} 對帳有差額`, detail:`${row.billMonth}｜差額 NT$ ${Math.round(number(row.diff)).toLocaleString("zh-TW")}`, route:"accounts/statements" }));
    const marketTime = new Date(assets.marketDataMeta?.generatedAt || assets.fxRateMeta?.generatedAt || 0).getTime();
    if (!marketTime || Date.now() - marketTime > 72 * 60 * 60 * 1000) issues.push({ id:"stale-market", level:"warning", title:"股價或匯率資料已超過 72 小時", detail:"請更新市場資料後再檢視資產總額", route:"investments/portfolio" });
    (ledger.accounts || []).filter(row => row.archived && Math.abs(number((assetsSummary.accounts || []).find(item => item.id === row.id)?.balance)) > 0.01).forEach(row => issues.push({ id:`archived-balance:${row.id}`, level:"info", title:`封存帳戶「${row.name}」仍有餘額`, detail:"歷史資料會保留；若已結清可再確認期初餘額與轉帳", route:"accounts/accounts" }));
    const levelWeight = { danger: 12, warning: 5, info: 1 };
    const score = Math.max(0, 100 - issues.reduce((sum, row) => sum + levelWeight[row.level], 0));
    return { checkedAt: nowIso(), score, issues, counts: { danger: issues.filter(row => row.level === "danger").length, warning: issues.filter(row => row.level === "warning").length, info: issues.filter(row => row.level === "info").length } };
  }

  function repairSafeData() {
    return commit("執行安全資料修復", ledger => {
      let repaired = 0;
      const seenIds = new Set();
      ["entries", "transfers", "accounts", "creditBills", "creditInstallments", "reconciliations", "creditStatementChecks", "loans", "goals"].forEach(collection => {
        (ledger[collection] || []).forEach(row => {
          if (!row.id || seenIds.has(row.id)) { row.id = uid(collection.slice(0, -1) || "record"); repaired += 1; }
          seenIds.add(row.id);
        });
      });
      (ledger.entries || []).forEach(row => { if (!row.category) { row.category = "未分類"; repaired += 1; } });
      ledger.categories.expense = [...new Set((ledger.categories.expense || []).filter(Boolean))];
      ledger.categories.income = [...new Set((ledger.categories.income || []).filter(Boolean))];
      return repaired;
    });
  }

  function setAccountArchived(id, archived) {
    return commit(archived ? "封存財務帳戶" : "恢復財務帳戶", ledger => {
      const row = ledger.accounts.find(item => item.id === id);
      if (!row) throw new Error("找不到這個帳戶");
      row.archived = Boolean(archived);
      row.archivedAt = archived ? nowIso() : "";
      row.updatedAt = nowIso();
      return row;
    });
  }

  function loanMetrics(loan) {
    const schedule=loanSchedule(loan),first=schedule.rows[0];
    return { balance:number(loan.balance),annualRate:number(loan.annualRate),monthlyPayment:number(loan.monthlyPayment),nextInterest:first?.interest??number(loan.balance)*number(loan.annualRate)/1200,nextPrincipal:first?.principal??0,monthsRemaining:schedule.paidOff?schedule.rows.length:null,totalInterest:schedule.totalInterest,reason:schedule.reason };
  }
  function loanSchedule(loan,extraPayment=0,limit=600) { return window.FinanceIntelligence.loanSchedule(loan,extraPayment,limit); }
  function investmentAnalytics(year) { return window.FinanceIntelligence.performance(year); }
  function accountCashflow(days=90) { return window.FinanceIntelligence.forecast(days); }
  function goalFunding() { return window.FinanceIntelligence.funding(); }
  function monthlyAttribution(month) { return window.FinanceIntelligence.attribution(month); }

  function saveLoan(values) {
    return commit(values.id ? "修改貸款" : "新增貸款", ledger => {
      const row = values.id ? ledger.loans.find(item => item.id === values.id) : null;
      const data = { name:text(values.name), lender:text(values.lender), principal:Math.max(0,number(values.principal)), balance:Math.max(0,number(values.balance ?? values.principal)), annualRate:Math.max(0,number(values.annualRate)), monthlyPayment:Math.max(0,number(values.monthlyPayment)), nextDueDate:text(values.nextDueDate), account:text(values.account), note:text(values.note), closed:Boolean(values.closed), updatedAt:nowIso() };
      if (!data.name || !data.balance) throw new Error("請輸入貸款名稱與目前餘額");
      if (row && (ledger.loanPayments || []).some(payment=>payment.loanId===row.id) && data.balance!==row.balance) throw new Error("已有還款紀錄，請透過還款或撤回還款調整本金");
      if (row) Object.assign(row, data); else ledger.loans.push({ id:uid("loan"), ...data, createdAt:nowIso() });
      return row || ledger.loans[ledger.loans.length - 1];
    });
  }

  function removeLoan(id) { return commit("刪除貸款", ledger => { const index=ledger.loans.findIndex(row=>row.id===id);if(index<0)throw new Error("找不到貸款");if((ledger.loanPayments||[]).some(row=>row.loanId===id))throw new Error("請先撤回還款紀錄再刪除貸款");ledger.recycleBin.push({id:uid("trash"),kind:"loan",row:ledger.loans[index],removedAt:nowIso()});return ledger.loans.splice(index,1)[0]; }); }

  function saveGoal(values) {
    return commit(values.id ? "修改儲蓄目標" : "新增儲蓄目標", (ledger, assets) => {
      const row = values.id ? ledger.goals.find(item => item.id === values.id) : null;
      const data = { name:text(values.name), targetAmount:Math.max(0,number(values.targetAmount)), currentAmount:Math.max(0,number(values.currentAmount)), targetDate:text(values.targetDate), linkedAccount:text(values.linkedAccount), note:text(values.note), completed:Boolean(values.completed), updatedAt:nowIso() };
      if (!data.name || !data.targetAmount) throw new Error("請輸入目標名稱與目標金額");
      data.reservedAmount=data.currentAmount;
      data.priority=values.priority===undefined?number(row?.priority):Math.max(0,number(values.priority));
      if(data.currentAmount>data.targetAmount)throw new Error("圈存不可超過目標");
      if(data.currentAmount>0) {
        const account=core.accountBalances(ledger,assets).find(a=>a.name===data.linkedAccount&&a.type!=="信用卡"&&!a.archived);
        const used=ledger.goals.filter(g=>g.id!==row?.id&&!g.completed&&g.linkedAccount===data.linkedAccount).reduce((total,g)=>total+number(g.reservedAmount??g.currentAmount),0);
        if(!account||used+data.currentAmount>Math.max(0,account.twdBalance)+0.005)throw new Error("帳戶可圈存金額不足；請先建立零圈存目標，再配置資金");
      }
      const goalId=row?.id||uid("goal");
      ledger.goalAllocationHistory ||= [];
      ledger.goalAllocationHistory.push({id:uid("allocation"),goalId,account:data.linkedAccount,before:number(row?.reservedAmount??row?.currentAmount),amount:data.currentAmount,createdAt:nowIso()});
      if (row) Object.assign(row, data); else ledger.goals.push({ id:goalId, ...data, createdAt:nowIso() });
      return row || ledger.goals[ledger.goals.length - 1];
    });
  }

  function removeGoal(id) { return commit("刪除儲蓄目標", ledger => { const index=ledger.goals.findIndex(row=>row.id===id);if(index<0)throw new Error("找不到儲蓄目標");ledger.recycleBin.push({id:uid("trash"),kind:"goal",row:ledger.goals[index],removedAt:nowIso()});return ledger.goals.splice(index,1)[0]; }); }

  function saveAnnualPlan(values) {
    return commit("儲存年度財務計畫", ledger => {
      const year = String(values.year || new Date().getFullYear()).slice(0, 4);
      const row = ledger.annualPlans.find(item => item.year === year);
      const data = { year, expectedIncome:Math.max(0,number(values.expectedIncome)), spendingLimit:Math.max(0,number(values.spendingLimit)), emergencyFundTarget:Math.max(0,number(values.emergencyFundTarget)), investmentTarget:Math.max(0,number(values.investmentTarget)), benchmarkRate:number(values.benchmarkRate), note:text(values.note), updatedAt:nowIso() };
      if (row) Object.assign(row, data); else ledger.annualPlans.push({ id:uid("plan"), ...data, createdAt:nowIso() });
      return row || ledger.annualPlans[ledger.annualPlans.length - 1];
    });
  }

  function bulkUpdateEntries(values) {
    const ids = Array.isArray(values.ids) ? values.ids : String(values.ids || "").split(",").filter(Boolean);
    return commit("批次修改收支", ledger => {
      let updated = 0;
      ledger.entries.forEach(row => {
        if (!ids.includes(row.id)) return;
        ["category", "item", "account"].forEach(key => { if (values[key] !== undefined && values[key] !== "") row[key] = values[key]; });
        row.updatedAt = nowIso(); updated += 1;
      });
      return updated;
    });
  }

  function taxSummary(year = String(new Date().getFullYear())) {
    const { ledger, assets } = core.load();
    const dividends = (assets.dividends || []).filter(row => String(row.date || "").startsWith(year)).map(row => ({ ...row, twdAmount:number(row.amount) * core.fxRate(assets, row.currency || "TWD") }));
    const sells = core.stockPositionSummary(assets).trades.filter(row => row.type === "sell" && String(row.date || "").startsWith(year));
    const interest = (ledger.entries || []).filter(row => row.type === "income" && String(row.date || "").startsWith(year) && /利息/.test(`${row.category || ""}${row.item || ""}${row.merchant || ""}`));
    return { year, dividends, sells, interest, dividendIncome:dividends.reduce((sum,row)=>sum+number(row.twdAmount),0), realizedGain:sells.reduce((sum,row)=>sum+number(row.twdRealized),0), interestIncome:interest.reduce((sum,row)=>sum+number(row.amount),0) };
  }

  function benchmark(year = String(new Date().getFullYear())) {
    const bundle = core.insights();
    normalize(bundle.ledger);
    const plan = bundle.ledger.annualPlans.find(row => row.year === year) || {};
    const performance = investmentAnalytics(year);
    return { year, targetRate:number(plan.benchmarkRate), actualRate:performance.annual.annualizedRate, difference:performance.annual.annualizedRate===null?null:performance.annual.annualizedRate-number(plan.benchmarkRate), reason:performance.annual.reason, investmentTarget:number(plan.investmentTarget), currentValue:number(performance.value) };
  }

  window.FinanceUpgrades = Object.freeze({ normalize, audit, repairSafeData, setAccountArchived, loanMetrics, loanSchedule, investmentAnalytics, accountCashflow, goalFunding, monthlyAttribution, saveLoan, removeLoan, saveGoal, removeGoal, saveAnnualPlan, bulkUpdateEntries, taxSummary, benchmark });
})();
