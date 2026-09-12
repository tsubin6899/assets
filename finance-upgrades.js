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
    const balance = Math.max(0, number(loan.balance));
    const annualRate = Math.max(0, number(loan.annualRate));
    const monthlyRate = annualRate / 100 / 12;
    const monthlyPayment = Math.max(0, number(loan.monthlyPayment));
    const interest = balance * monthlyRate;
    const principalPayment = Math.max(0, monthlyPayment - interest);
    const schedule = loanSchedule(loan);
    const monthsRemaining = schedule.paidOff ? schedule.rows.length : null;
    return { balance, annualRate, monthlyPayment, nextInterest: interest, nextPrincipal: principalPayment, monthsRemaining, totalInterest:schedule.totalInterest };
  }

  function addMonths(value, count) { const date=new Date(`${value || core.localDate()}T00:00:00`);date.setMonth(date.getMonth()+count);return core.localDate(date); }
  function loanSchedule(loan, extraPayment = 0, limit = 600) {
    let balance=Math.max(0,number(loan.balance)),totalInterest=0;const rate=Math.max(0,number(loan.annualRate))/1200,payment=Math.max(0,number(loan.monthlyPayment))+Math.max(0,number(extraPayment)),rows=[];
    for(let period=1;balance>0.005&&period<=limit;period+=1){const interest=balance*rate,principal=Math.min(balance,Math.max(0,payment-interest));if(principal<=0)break;balance=Math.max(0,balance-principal);totalInterest+=interest;rows.push({period,date:addMonths(loan.nextDueDate||core.localDate(),period-1),payment:principal+interest,principal,interest,balance});}
    return { rows, totalInterest, paidOff:balance<=0.005, remainingBalance:balance, extraPayment:Math.max(0,number(extraPayment)) };
  }

  function investmentAnalytics(year = String(new Date().getFullYear())) {
    const { assets }=core.load(),positions=core.stockPositionSummary(assets),base=core.investmentPerformance(assets),start=`${year}-01-01`,end=`${year}-12-31`;
    const trades=positions.trades.filter(row=>String(row.date||"")>=start&&String(row.date||"")<=end),dividends=(assets.dividends||[]).filter(row=>String(row.date||"")>=start&&String(row.date||"")<=end);
    const buys=trades.filter(row=>row.type!=="sell").reduce((sum,row)=>sum+number(row.twdNetAmount),0),saleProceeds=trades.filter(row=>row.type==="sell").reduce((sum,row)=>sum+number(row.twdNetAmount),0),realized=trades.filter(row=>row.type==="sell").reduce((sum,row)=>sum+number(row.twdRealized),0),dividendIncome=dividends.reduce((sum,row)=>sum+number(row.amount)*core.fxRate(assets,row.currency||"TWD"),0);
    const allTrades=positions.trades.filter(row=>String(row.date||"")<=core.localDate()),allDividends=(assets.dividends||[]).filter(row=>String(row.date||"")<=core.localDate());
    const cashflows=[...allTrades.map(row=>({date:row.date,amount:(row.type==="sell"?1:-1)*number(row.twdNetAmount)})),...allDividends.map(row=>({date:row.date,amount:number(row.amount)*core.fxRate(assets,row.currency||"TWD")})),{date:core.localDate(),amount:number(base.value)}].filter(row=>row.date&&row.amount);
    const first=cashflows.reduce((min,row)=>row.date<min?row.date:min,cashflows[0]?.date||core.localDate());
    const npv=rate=>cashflows.reduce((sum,row)=>sum+row.amount/Math.pow(1+rate,(new Date(row.date)-new Date(first))/31557600000),0);let low=-0.9999,high=10;
    for(let i=0;i<100;i+=1){const mid=(low+high)/2;if(npv(mid)>0)low=mid;else high=mid;}
    const moneyWeighted=cashflows.some(row=>row.amount<0)&&cashflows.some(row=>row.amount>0)?(low+high)/2*100:0;
    const totalGain=realized+dividendIncome+number(base.unrealized),denominator=Math.max(0.01,buys);
    return {...base,year,buys,saleProceeds,realized,dividendIncome,totalGain,simpleRate:totalGain/denominator*100,moneyWeightedRate:moneyWeighted};
  }

  function accountCashflow(days = 90) {
    const bundle=core.insights(),today=core.localDate(),end=new Date(`${today}T00:00:00`);end.setDate(end.getDate()+days);const endDate=core.localDate(end),accounts=bundle.assetsSummary.accounts.filter(row=>row.type!=="信用卡"&&!row.archived),rules=bundle.ledger.recurringRules||[],bills=bundle.ledger.creditBills||[];
    const months=[];for(let i=0;i<5;i+=1){const date=new Date(`${today}T00:00:00`);date.setMonth(date.getMonth()+i);months.push(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`);}
    const events=months.flatMap(month=>core.recurringOccurrences(bundle.ledger,month,today)).filter(row=>row.scheduledDate>today&&row.scheduledDate<=endDate).map(row=>({date:row.scheduledDate,account:row.account,amount:(row.type==="income"?1:-1)*number(row.amount)}));
    bills.filter(row=>!row.paid&&row.dueDate>today&&row.dueDate<=endDate).forEach(row=>events.push({date:row.dueDate,account:row.payAccount,amount:-number(row.amount),title:row.card}));
    return accounts.map(account=>{let balance=number(account.balance),minimum=balance,minimumDate=today;const rows=[];for(let i=1;i<=days;i+=1){const dateObj=new Date(`${today}T00:00:00`);dateObj.setDate(dateObj.getDate()+i);const date=core.localDate(dateObj),change=events.filter(row=>row.date===date&&row.account===account.name).reduce((sum,row)=>sum+row.amount,0);balance+=change;if(balance<minimum){minimum=balance;minimumDate=date;}if(change||i===days)rows.push({date,change,balance});}return {account:account.name,currency:account.currency||"TWD",opening:number(account.balance),minimum,minimumDate,ending:balance,shortfall:Math.max(0,-minimum),rows};});
  }

  function goalFunding() {
    const bundle=core.insights(),available=new Map(bundle.assetsSummary.accounts.filter(row=>row.type!=="信用卡").map(row=>[row.name,Math.max(0,number(row.balance))]));
    return (bundle.ledger.goals||[]).filter(row=>!row.completed).map(row=>{const wanted=Math.max(0,number(row.targetAmount)-number(row.currentAmount)),pool=available.get(row.linkedAccount)||0,allocated=Math.min(wanted,pool);available.set(row.linkedAccount,Math.max(0,pool-allocated));const months=Math.max(1,Math.ceil((new Date(row.targetDate||core.localDate())-new Date())/2629800000)),monthly=Math.max(0,wanted-allocated)/months;return {...row,wanted,allocated,unfunded:wanted-allocated,monthly,months};});
  }

  function monthlyAttribution(month = core.monthOf()) {
    const bundle=core.insights(),summary=core.monthSummary(bundle.ledger,bundle.assets,month),positions=core.stockPositionSummary(bundle.assets),realized=positions.trades.filter(row=>row.type==="sell"&&String(row.date||"").startsWith(month)).reduce((sum,row)=>sum+number(row.twdRealized),0),dividends=(bundle.assets.dividends||[]).filter(row=>String(row.date||"").startsWith(month)).reduce((sum,row)=>sum+number(row.amount)*core.fxRate(bundle.assets,row.currency||"TWD"),0),snapshots=[...(bundle.assets.assetSnapshots||[])].filter(row=>String(row.date||"").slice(0,7)<=month).sort((a,b)=>String(a.date).localeCompare(String(b.date))),previous=snapshots.filter(row=>String(row.date).slice(0,7)<month).at(-1),current=snapshots.filter(row=>String(row.date).slice(0,7)===month).at(-1);const netChange=previous&&current?number(current.net??current.total)-number(previous.net??previous.total):summary.balance+realized;const explained=summary.balance+realized;return {month,netChange,cashflow:summary.balance,realized,dividends,marketAndFx:netChange-explained,hasSnapshots:Boolean(previous&&current)};
  }

  function saveLoan(values) {
    return commit(values.id ? "修改貸款" : "新增貸款", ledger => {
      const row = values.id ? ledger.loans.find(item => item.id === values.id) : null;
      const data = { name:text(values.name), lender:text(values.lender), principal:Math.max(0,number(values.principal)), balance:Math.max(0,number(values.balance ?? values.principal)), annualRate:Math.max(0,number(values.annualRate)), monthlyPayment:Math.max(0,number(values.monthlyPayment)), nextDueDate:text(values.nextDueDate), account:text(values.account), note:text(values.note), closed:Boolean(values.closed), updatedAt:nowIso() };
      if (!data.name || !data.balance) throw new Error("請輸入貸款名稱與目前餘額");
      if (row) Object.assign(row, data); else ledger.loans.push({ id:uid("loan"), ...data, createdAt:nowIso() });
      return row || ledger.loans[ledger.loans.length - 1];
    });
  }

  function removeLoan(id) { return commit("刪除貸款", ledger => { const index=ledger.loans.findIndex(row=>row.id===id);if(index<0)throw new Error("找不到貸款");return ledger.loans.splice(index,1)[0]; }); }

  function saveGoal(values) {
    return commit(values.id ? "修改儲蓄目標" : "新增儲蓄目標", ledger => {
      const row = values.id ? ledger.goals.find(item => item.id === values.id) : null;
      const data = { name:text(values.name), targetAmount:Math.max(0,number(values.targetAmount)), currentAmount:Math.max(0,number(values.currentAmount)), targetDate:text(values.targetDate), linkedAccount:text(values.linkedAccount), note:text(values.note), completed:Boolean(values.completed), updatedAt:nowIso() };
      if (!data.name || !data.targetAmount) throw new Error("請輸入目標名稱與目標金額");
      if (row) Object.assign(row, data); else ledger.goals.push({ id:uid("goal"), ...data, createdAt:nowIso() });
      return row || ledger.goals[ledger.goals.length - 1];
    });
  }

  function removeGoal(id) { return commit("刪除儲蓄目標", ledger => { const index=ledger.goals.findIndex(row=>row.id===id);if(index<0)throw new Error("找不到儲蓄目標");return ledger.goals.splice(index,1)[0]; }); }

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
    return { year, targetRate:number(plan.benchmarkRate), actualRate:number(performance.moneyWeightedRate), difference:number(performance.moneyWeightedRate)-number(plan.benchmarkRate), investmentTarget:number(plan.investmentTarget), currentValue:number(performance.value) };
  }

  window.FinanceUpgrades = Object.freeze({ normalize, audit, repairSafeData, setAccountArchived, loanMetrics, loanSchedule, investmentAnalytics, accountCashflow, goalFunding, monthlyAttribution, saveLoan, removeLoan, saveGoal, removeGoal, saveAnnualPlan, bulkUpdateEntries, taxSummary, benchmark });
})();
