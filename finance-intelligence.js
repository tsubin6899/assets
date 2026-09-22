(function () {
  "use strict";
  const core = window.FinanceCore;
  const n = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const stamp = () => new Date().toISOString();
  const sum = (rows, fn) => rows.reduce((total, row) => total + fn(row), 0);
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && core.localDate(new Date(`${value}T12:00:00`)) === value; }
  function day(value, offset) { const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate() + offset); return core.localDate(d); }
  function monthDate(value, offset, anchorDay) {
    const d = new Date(`${value}T12:00:00`), target = anchorDay || d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + offset);
    d.setDate(Math.min(target, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return core.localDate(d);
  }
  function transact(reason, fn) { const b = core.load(); const result = fn(b.ledger, b.assets); core.persist(b.ledger, b.assets, reason); return result; }
  function xirr(flows) {
    const grouped = new Map();
    for (const f of flows) {
      if (!validDate(f.date) || !Number.isFinite(f.amount)) return { rate:null, reason:"現金流日期或金額不完整" };
      grouped.set(f.date, (grouped.get(f.date) || 0) + f.amount);
    }
    const rows = [...grouped].sort(([a], [b]) => a.localeCompare(b)).filter(([, amount]) => Math.abs(amount) > 1e-8);
    if (rows.length < 2 || !rows.some(([,v]) => v < 0) || !rows.some(([,v]) => v > 0)) return { rate:null, reason:"需要不同日期的投入與回收資金" };
    const changes = rows.slice(1).filter(([,v], i) => Math.sign(v) !== Math.sign(rows[i][1])).length;
    if (changes > 1) return { rate:null, reason:"現金流多次變號，可能有多個報酬率，暫不提供單一數值" };
    const first = Date.parse(rows[0][0]), scale = Math.max(...rows.map(([,v]) => Math.abs(v)));
    const npv = logRate => sum(rows, ([date, amount]) => amount / scale * Math.exp(-logRate * (Date.parse(date) - first) / 31536000000));
    let low = -20, high = 20, left = npv(low), right = npv(high);
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.sign(left) === Math.sign(right)) return { rate:null, reason:"在可計算範圍內找不到收斂解" };
    for (let i = 0; i < 180; i++) { const mid = (low + high) / 2, value = npv(mid); if (Math.sign(value) === Math.sign(left)) { low = mid; left = value; } else high = mid; }
    const root = (low + high) / 2, rate = Math.expm1(root) * 100;
    return Number.isFinite(rate) && Math.abs(npv(root)) < 1e-7 ? { rate, reason:"" } : { rate:null, reason:"報酬率未收斂" };
  }
  function historicalRate(assets, row, currency) {
    if (currency === "TWD") return 1;
    const explicit = n(row.bookedFxRate);
    if (explicit > 0) return explicit;
    const rate = n(assets.fxHistory?.[row.date]?.[currency]);
    return rate > 0 ? rate : null;
  }
  function freezeNewRates(ledger, assets, oldAssets, oldLedger = {}) {
    const previousEntries=new Map((oldLedger.entries||[]).map(row=>[row.id,row]));
    for(const row of ledger.entries||[]){const old=previousEntries.get(row.id),account=ledger.accounts.find(a=>a.name===row.account);if(old&&(row.date!==old.date||row.account!==old.account))delete row.bookedAccountFxRate;if(account?.currency==="TWD")row.bookedAccountFxRate=1;if(!old&&row.date===core.localDate()&&account)row.bookedAccountFxRate=core.fxRate(assets,account.currency);}
    for (const key of ["purchaseRecords", "dividends"]) {
      const previous = new Map((oldAssets[key] || []).map(row => [row.id, row]));
      for (const row of assets[key] || []) {
        const currency = row.currency || (row.market === "US" || row.market === "USD_FUND" ? "USD" : "TWD"), old = previous.get(row.id);
        if (old && (old.date !== row.date || old.currency !== row.currency)) { delete row.bookedFxRate; delete row.bookedAccountFxRate; }
        if (currency === "TWD") row.bookedFxRate = 1;
        if (!old && row.date === core.localDate() && !row.bookedFxRate) row.bookedFxRate = core.fxRate(assets, currency);
        const account = (ledger.accounts || []).find(a => a.name === row.cashAccount);
        if (account?.currency === "TWD") row.bookedAccountFxRate = 1;
        if (!old && row.date === core.localDate() && account && !row.bookedAccountFxRate) row.bookedAccountFxRate = core.fxRate(assets, account.currency);
      }
    }
  }
  function capture(ledger, assets, date = core.localDate()) {
    if (date !== core.localDate()) throw new Error("歷史估值請輸入當日對帳單數值，不可套用今日市值");
    const filtered = { ...assets, purchaseRecords:(assets.purchaseRecords || []).filter(r => r.date <= date), dividends:(assets.dividends || []).filter(r => r.date <= date) };
    const summary = core.assetSummary(ledger, filtered), positions = core.stockPositionSummary(filtered), groups = new Map();
    for (const row of [...positions.active, ...positions.manualOnly]) {
      const currency = row.currency || "TWD", rate = core.fxRate(assets, currency);
      const g = groups.get(currency) || { currency, nativeValue:0, rate };
      g.nativeValue += n(row.value) / rate; groups.set(currency, g);
    }
    return { id:`valuation-${date}`, date, capturedAt:stamp(), source:"daily", net:summary.netWorth,
      investment:sum([...groups.values()], r => r.nativeValue * r.rate), investmentCurrencies:[...groups.values()],
      accounts:summary.accounts.map(r => ({ id:r.id, name:r.name, currency:r.currency, balance:r.balance, rate:core.fxRate(assets,r.currency), type:r.type })),
      fxRates:copy(assets.fxRates || {}), marketPrices:copy(assets.marketPrices || {}) };
  }
  function storeDaily(ledger, assets) {
    const snapshot = capture(ledger, assets), rows = assets.financialSnapshots || [];
    assets.financialSnapshots = [...rows.filter(r => r.date !== snapshot.date), snapshot].sort((a,b)=>a.date.localeCompare(b.date));
  }
  function saveValuation(values) {
    if (!validDate(values.date) || values.date > core.localDate()) throw new Error("請輸入已發生的有效日期");
    for (const key of ["net", "investment"]) if (values[key] === "" || !Number.isFinite(Number(values[key]))) throw new Error("請輸入對帳單的淨資產及證券投資總值");
    if (Number(values.investment) < 0) throw new Error("投資總值不可為負");
    return transact("儲存對帳單歷史估值", (ledger, assets) => {
      const row = { id:`valuation-${values.date}`, date:values.date, net:Number(values.net), investment:Number(values.investment), source:"statement", note:String(values.note || ""), capturedAt:stamp(), investmentCurrencies:null };
      assets.financialSnapshots = [...(assets.financialSnapshots || []).filter(r=>r.date!==row.date),row]; return row;
    });
  }
  function saveHistoricalRate(values) {
    const currency = String(values.currency || "").toUpperCase();
    if (!validDate(values.date) || values.date > core.localDate() || !/^[A-Z]{3}$/.test(currency) || !(Number(values.rate) > 0)) throw new Error("請輸入有效日期、三碼幣別與正數匯率");
    if (currency === "TWD" && Number(values.rate) !== 1) throw new Error("TWD 匯率必須為 1");
    return transact("儲存歷史匯率", (ledger, assets) => { assets.fxHistory ||= {}; assets.fxHistory[values.date] ||= {}; assets.fxHistory[values.date][currency] = Number(values.rate); });
  }
  function investmentFlows(assets, start, end) {
    const flows = [], missing = [];
    for (const row of assets.purchaseRecords || []) {
      if (row.date < start || row.date > end) continue;
      const currency = row.currency || (["US","USD_FUND"].includes(row.market) ? "USD" : "TWD"), rate = historicalRate(assets,row,currency);
      const amount = row.type === "sell" ? n(row.shares)*n(row.price)-n(row.fee)-n(row.tax) : -(n(row.shares)*n(row.price)+n(row.fee)+n(row.tax));
      if (rate === null) missing.push(`${row.date} ${currency}`);
      flows.push({ id:row.id, date:row.date, currency, native:amount, amount:rate === null ? null : amount*rate, kind:row.type === "sell" ? "sell" : "buy", title:row.code || row.name });
    }
    for (const row of assets.dividends || []) {
      if (row.date < start || row.date > end) continue;
      const currency = row.currency || "TWD", rate = historicalRate(assets,row,currency);
      if (rate === null) missing.push(`${row.date} ${currency}`);
      flows.push({ id:row.id, date:row.date, currency, native:n(row.amount), amount:rate === null ? null : n(row.amount)*rate, kind:"dividend", title:row.source });
    }
    return { flows, missing:[...new Set(missing)] };
  }
  function performance(year = String(new Date().getFullYear()), bundle = core.load()) {
    const { ledger, assets } = bundle, today = core.localDate(), snapshots = assets.financialSnapshots || [];
    const currentAssets = {...assets,purchaseRecords:(assets.purchaseRecords||[]).filter(r=>r.date<=today)};
    const positions = core.stockPositionSummary(currentAssets), base = core.investmentPerformance(currentAssets), current = capture(ledger,assets);
    function period(start, end, lifetime) {
      const openingDate = day(start,-1), opening = lifetime ? null : snapshots.find(r=>r.date===openingDate);
      const ending = end === today ? current : snapshots.find(r=>r.date===end);
      const prior = (assets.purchaseRecords||[]).some(r=>r.date<start), manual = positions.manualOnly.length > 0;
      const openingValue = lifetime ? 0 : opening ? n(opening.investment) : !prior && !manual ? 0 : null;
      const {flows,missing} = investmentFlows(assets,start,end);
      let reason = end < start ? "該期間尚未開始" : !ending ? `缺少 ${end} 期末估值` : openingValue === null ? `缺少 ${openingDate} 期初估值` : lifetime && manual ? "手動持倉缺少原始投入，無法計算成立以來報酬" : missing.length ? `缺少歷史匯率：${missing.join("、")}` : "";
      const input = [...flows.map(r=>({date:r.date,amount:r.amount})), ...(openingValue ? [{date:openingDate,amount:-openingValue}] : []), ...(ending ? [{date:end,amount:n(ending.investment)}] : [])];
      const result = reason ? {rate:null,reason} : xirr(input);
      const gain = reason ? null : n(ending.investment)-openingValue+sum(flows,r=>n(r.amount));
      return { start,end,opening:openingValue,ending:ending?.investment??null,gain,annualizedRate:result.rate,reason:result.reason,flows,missing };
    }
    const dates = [...(assets.purchaseRecords||[]),...(assets.dividends||[])].filter(r=>r.date<=today).map(r=>r.date).sort();
    const annual = period(`${year}-01-01`,`${year}-12-31` < today ? `${year}-12-31` : today,false), lifetime = period(dates[0]||today,today,true);
    const sells = positions.trades.filter(r=>r.type==="sell"&&r.date>=annual.start&&r.date<=annual.end);
    const realized = sells.some(r=>historicalRate(assets,r,r.currency)===null) ? null : sum(sells,r=>n(r.realized)*historicalRate(assets,r,r.currency));
    const dividendFlows = annual.flows.filter(r=>r.kind==="dividend");
    return {...base,year,annual,lifetime,realized,dividendIncome:dividendFlows.some(r=>r.amount===null)?null:sum(dividendFlows,r=>r.amount),moneyWeightedRate:lifetime.annualizedRate};
  }
  function loanSchedule(loan, extra = 0, limit = 600) {
    let balance=round(Math.max(0,n(loan.balance))), totalInterest=0;
    const rows=[], payment=round(n(loan.monthlyPayment)+Math.max(0,n(extra))), rate=Math.max(0,n(loan.annualRate))/1200;
    const anchor=n(loan.paymentDay)||Number(String(loan.nextDueDate||core.localDate()).slice(8));
    for(let i=0;balance>0&&i<limit;i++) {
      const interest=round(balance*rate), principal=round(Math.min(balance,payment-interest));
      if(principal<=0) break;
      balance=round(balance-principal);totalInterest=round(totalInterest+interest);
      rows.push({period:i+1,date:monthDate(loan.nextDueDate||core.localDate(),i,anchor),principal,interest,payment:round(principal+interest),balance});
    }
    return {rows,totalInterest,paidOff:balance===0,remainingBalance:balance,reason:balance===0?"":rows.length>=limit?"超過 600 期試算範圍":"月付額不足以攤還本金"};
  }
  function recordLoanPayment(values) {
    return transact("記錄貸款還款", (ledger,assets)=>{
      const loan=(ledger.loans||[]).find(r=>r.id===values.loanId), account=(ledger.accounts||[]).find(r=>r.name===values.account);
      if(!loan||loan.closed)throw new Error("貸款不存在或已結清");
      if(!account||account.archived||account.type==="信用卡")throw new Error("請選擇有效扣款帳戶");
      if(!validDate(values.date)||values.date>core.localDate())throw new Error("只可記錄已發生的還款日期");
      const principal=round(Number(values.principal)),interest=round(Number(values.interest));
      if(!Number.isFinite(principal)||!Number.isFinite(interest)||principal<=0||interest<0||principal>n(loan.balance))throw new Error("本金須大於零且不超過餘額，利息不可為負");
      ledger.loanPayments ||= [];
      const dueDate=loan.nextDueDate||values.date;
      if(values.dueDate&&values.dueDate!==dueDate)throw new Error("貸款期別已變更，請重新開啟還款表單");
      if(values.mode!=="extra"&&ledger.loanPayments.some(r=>r.loanId===loan.id&&r.dueDate===dueDate&&r.mode!=="extra"))throw new Error("本期已記錄還款");
      const rate=account.currency==="TWD"?1:n(assets.fxHistory?.[values.date]?.[account.currency])||(values.date===core.localDate()?core.fxRate(assets,account.currency):0);
      if(!(rate>0))throw new Error("外幣歷史還款需先補登當日匯率");
      const amount=round((principal+interest)/rate);
      const row={id:id("loan-payment"),loanId:loan.id,name:loan.name,date:values.date,dueDate,mode:values.mode==="extra"?"extra":"regular",account:account.name,currency:account.currency,amount,principal,interest,rate,beforeBalance:loan.balance,beforeDueDate:loan.nextDueDate,createdAt:stamp()};
      loan.balance=round(n(loan.balance)-principal);loan.closed=loan.balance===0;loan.paymentDay ||= Number(dueDate.slice(8));
      if(row.mode!=="extra")loan.nextDueDate=monthDate(dueDate,1,loan.paymentDay);
      loan.updatedAt=stamp();ledger.loanPayments.push(row);return row;
    });
  }
  function undoLoanPayment(paymentId) {
    return transact("撤回貸款還款",ledger=>{
      const rows=ledger.loanPayments||[],row=rows.find(r=>r.id===paymentId),loan=ledger.loans.find(r=>r.id===row?.loanId);
      if(!row||!loan)throw new Error("找不到還款紀錄");
      if(rows.filter(r=>r.loanId===loan.id).at(-1)?.id!==paymentId)throw new Error("請由最新還款開始撤回");
      loan.balance=row.beforeBalance;loan.nextDueDate=row.beforeDueDate;loan.closed=false;loan.updatedAt=stamp();
      ledger.loanPayments=rows.filter(r=>r.id!==paymentId);ledger.recycleBin.push({id:id("trash"),kind:"loanPayment",row:copy(row),removedAt:stamp()});
    });
  }
  function funding(bundle=core.load()) {
    const accounts=core.accountBalances(bundle.ledger,bundle.assets).filter(r=>r.type!=="信用卡"&&!r.archived), pools=new Map(accounts.map(r=>[r.name,Math.max(0,r.twdBalance)]));
    return [...(bundle.ledger.goals||[])].sort((a,b)=>n(a.priority)-n(b.priority)||String(a.id).localeCompare(String(b.id))).map(row=>{
      const requested=Math.max(0,n(row.reservedAmount??row.currentAmount)), pool=pools.get(row.linkedAccount)||0;
      const allocated=row.completed?0:Math.min(requested,pool,n(row.targetAmount));pools.set(row.linkedAccount,Math.max(0,pool-allocated));
      const wanted=Math.max(0,n(row.targetAmount)-allocated), months=validDate(row.targetDate)?Math.max(1,Math.ceil((Date.parse(row.targetDate)-Date.parse(core.localDate()))/2629800000)):null;
      return {...row,requested,allocated,currentAmount:allocated,wanted,unfunded:wanted,shortfall:Math.max(0,requested-allocated),monthly:months?wanted/months:null,months};
    });
  }
  function reserveGoal(values) {
    return transact("調整目標圈存",(ledger,assets)=>{
      const goal=ledger.goals.find(r=>r.id===values.goalId),amount=round(Number(values.amount));
      if(!goal||goal.completed)throw new Error("請選擇未完成的目標");
      if(!Number.isFinite(amount)||amount<0||amount>n(goal.targetAmount))throw new Error("圈存金額須介於零與目標金額之間（台幣）");
      const account=core.accountBalances(ledger,assets).find(r=>r.name===values.account&&r.type!=="信用卡"&&!r.archived);
      if(!account)throw new Error("請選擇有效圈存帳戶");
      const used=sum((ledger.goals||[]).filter(r=>r.id!==goal.id&&!r.completed&&r.linkedAccount===account.name),r=>Math.max(0,n(r.reservedAmount??r.currentAmount)));
      const releasing=goal.linkedAccount===account.name&&amount<=n(goal.reservedAmount??goal.currentAmount);
      if(!releasing&&used+amount>Math.max(0,account.twdBalance)+0.005)throw new Error("帳戶可圈存資金不足，請先釋放其他目標金額");
      ledger.goalAllocationHistory ||= [];
      ledger.goalAllocationHistory.push({id:id("reservation"),goalId:goal.id,date:core.localDate(),before:n(goal.reservedAmount??goal.currentAmount),amount,account:account.name,previousAccount:goal.linkedAccount,createdAt:stamp()});
      Object.assign(goal,{linkedAccount:account.name,reservedAmount:amount,currentAmount:amount,priority:Math.max(0,n(values.priority)),updatedAt:stamp()});
    });
  }
  function forecast(days=90,bundle=core.load()) {
    const {ledger,assets}=bundle,today=core.localDate(),end=day(today,days),accounts=core.accountBalances(ledger,assets).filter(r=>r.type!=="信用卡"&&!r.archived),events=[],warnings=[];
    const add=(date,account,amount,title,sourceId)=>{if(date>today&&date<=end){if(!accounts.some(a=>a.name===account)){warnings.push(`${title}：未指定有效現金帳戶`);return;}events.push({date,account,amount,title,sourceId});}};
    const entries=(ledger.entries||[]).filter(r=>!r.recurringSkipped);
    entries.forEach(r=>{if((ledger.accounts||[]).find(a=>a.name===r.account)?.type!=="信用卡")add(r.date,r.account,(r.type==="income"?1:-1)*n(r.amount),r.merchant||r.category,r.id);});
    for(let month=today.slice(0,7);month<=end.slice(0,7);month=monthDate(`${month}-01`,1).slice(0,7)) {
      core.recurringOccurrences(ledger,month,today).filter(r=>r.virtual).forEach(r=>{
        const account=ledger.accounts.find(a=>a.name===r.account);
        if(account?.type==="信用卡"){if(r.date>today&&r.date<=end)warnings.push(`${r.merchant}：未出帳刷卡需另建立預計帳單`);return;}
        add(r.date,r.account,(r.type==="income"?1:-1)*n(r.amount),r.merchant,r.id);
      });
    }
    (ledger.transfers||[]).forEach(r=>{add(r.date,r.fromAccount,-n(r.fromAmount),"轉出",r.id);if(accounts.some(a=>a.name===r.toAccount))add(r.date,r.toAccount,n(r.toAmount),"轉入",r.id);if(n(r.feeAmount))add(r.date,r.feeAccount||r.fromAccount,-n(r.feeAmount),"轉帳手續費",r.id);});
    (ledger.creditBills||[]).filter(r=>!r.paid).forEach(r=>{
      if(!validDate(r.dueDate)){warnings.push(`${r.card}：帳單未設定到期日`);return;}
      if((ledger.transfers||[]).some(t=>t.id===r.transferId||t.creditBillId===r.id))return;
      const card=ledger.accounts.find(a=>a.name===r.card),account=ledger.accounts.find(a=>a.name===r.payAccount);
      add(r.dueDate<=today?day(today,1):r.dueDate,r.payAccount,-n(r.amount)*core.fxRate(assets,card?.currency||"TWD")/core.fxRate(assets,account?.currency||"TWD"),`${r.card} 帳單${r.dueDate<=today?"（到期未繳）":""}`,r.id);
    });
    (ledger.loans||[]).filter(r=>!r.closed).forEach(loan=>{
      if(!validDate(loan.nextDueDate)){warnings.push(`${loan.name}：未設定繳款日期`);return;}
      const account=accounts.find(a=>a.name===loan.account);
      for(const row of loanSchedule(loan).rows){if(row.date>end)break;add(row.date<=today?day(today,1):row.date,loan.account,-row.payment/core.fxRate(assets,account?.currency||"TWD"),`${loan.name} 還款`,loan.id);}
    });
    for(const kind of ["purchaseRecords","dividends"])for(const r of assets[kind]||[]){
      if(r.date<=today||r.date>end||!r.cashAccount)continue;
      const account=accounts.find(a=>a.name===r.cashAccount),currency=r.currency||"TWD",amount=kind==="dividends"?n(r.amount):r.type==="sell"?n(r.price)*n(r.shares)-n(r.fee)-n(r.tax):-(n(r.price)*n(r.shares)+n(r.fee)+n(r.tax));
      add(r.date,r.cashAccount,amount*core.fxRate(assets,currency)/core.fxRate(assets,account?.currency||"TWD"),kind==="dividends"?"預計股息":"預計投資交易",r.id);
    }
    const reservations=funding(bundle);
    const result=accounts.map(a=>{let balance=a.balance,minimum=balance,minimumDate=today;const rows=[],reserved=sum(reservations.filter(g=>g.linkedAccount===a.name),g=>g.allocated)/core.fxRate(assets,a.currency);
      for(let i=1;i<=days;i++){const date=day(today,i),items=events.filter(e=>e.date===date&&e.account===a.name),change=sum(items,r=>r.amount);balance+=change;if(balance<minimum){minimum=balance;minimumDate=date;}rows.push({date,change,balance,available:balance-reserved,events:items});}
      return {account:a.name,currency:a.currency||"TWD",opening:a.balance,minimum,minimumDate,ending:balance,shortfall:Math.max(0,-minimum),reserved,rows,warnings:[...new Set(warnings)]};});
    result.warnings=[...new Set(warnings)];return result;
  }
  function attribution(month=core.monthOf(),bundle=core.load()) {
    const {ledger,assets}=bundle,start=`${month}-01`,end=day(monthDate(start,1),-1),openingDate=day(start,-1),snapshots=assets.financialSnapshots||[],opening=snapshots.find(r=>r.date===openingDate),ending=snapshots.find(r=>r.date===end);
    const events=core.buildEvents(ledger,assets).filter(r=>r.date>=start&&r.date<=end&&!r.pending),details={cashflow:[],adjustments:[],price:[],fx:[]},missing=[];
    for(const e of events.filter(e=>["income","expense","dividend"].includes(e.kind))){
      const target=e.isReconciliationAdjustment?"adjustments":"cashflow",rate=e.currency==="TWD"?1:e.kind==="dividend"?historicalRate(assets,e.raw,e.currency):n(e.raw?.bookedAccountFxRate)||n(assets.fxHistory?.[e.date]?.[e.currency])||null;
      if(rate===null)missing.push(`${e.date} ${e.currency}`);
      details[target].push({date:e.date,title:e.title,amount:rate===null?null:e.amount*rate*e.direction,id:e.sourceId});
    }
    const cashflow=details.cashflow.some(r=>r.amount===null)?null:sum(details.cashflow,r=>r.amount),adjustments=details.adjustments.some(r=>r.amount===null)?null:sum(details.adjustments,r=>r.amount),flows=investmentFlows(assets,start,end);
    let price=null,fx=null;
    if(opening?.investmentCurrencies&&ending?.investmentCurrencies&&!flows.missing.length){
      const currencies=new Set([...opening.investmentCurrencies,...ending.investmentCurrencies,...flows.flows].map(r=>r.currency));
      let complete=true;
      for(const currency of currencies){const a=opening.investmentCurrencies.find(r=>r.currency===currency),b=ending.investmentCurrencies.find(r=>r.currency===currency),rate=a?.rate||(currency==="TWD"?1:opening.fxRates?.[currency]);if(!rate){complete=false;break;}const trades=flows.flows.filter(r=>r.currency===currency&&r.kind!=="dividend"),nativeChange=n(b?.nativeValue)-n(a?.nativeValue)+sum(trades,r=>r.native),p=nativeChange*rate,f=n(b?.nativeValue)*n(b?.rate)-n(a?.nativeValue)*n(a?.rate)+sum(trades,r=>n(r.amount))-p;details.price.push({title:`${currency} 證券價格損益（含交易費用）`,amount:p});details.fx.push({title:`${currency} 證券匯率損益`,amount:f});}
      if(complete){price=sum(details.price,r=>r.amount);fx=sum(details.fx,r=>r.amount);}
    }
    const hasSnapshots=Boolean(opening&&ending),netChange=hasSnapshots?n(ending.net)-n(opening.net):null;
    return {month,openingDate,end,hasSnapshots,netChange,cashflow,adjustments,price,fx,unexplained:hasSnapshots&&cashflow!==null&&adjustments!==null?netChange-cashflow-adjustments-n(price)-n(fx):null,details,reason:hasSnapshots?(missing.length?`收支缺少歷史匯率：${[...new Set(missing)].join("、")}`:""):`需要 ${openingDate} 與 ${end} 的當日快照或對帳單估值`,valuationReason:price===null?"缺少幣別估值或歷史匯率，價格／匯率尚未歸因":""};
  }
  const api={validDate,day,monthDate,xirr,historicalRate,freezeNewRates,capture,storeDaily,saveValuation,saveHistoricalRate,performance,loanSchedule,recordLoanPayment,undoLoanPayment,funding,reserveGoal,forecast,attribution};
  window.FinanceIntelligence=Object.freeze(api);
  Object.assign(core,{recordLoanPayment,undoLoanPayment,reserveGoal,saveValuation,saveHistoricalRate});
})();
