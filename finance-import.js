(function () {
  "use strict";

  function parseCsv(source) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    const text = String(source || "").replace(/^\uFEFF/, "");
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) { row.push(value.trim()); value = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        row.push(value.trim()); value = "";
        if (row.some(cell => cell !== "")) rows.push(row);
        row = [];
      } else value += char;
    }
    row.push(value.trim());
    if (row.some(cell => cell !== "")) rows.push(row);
    return rows;
  }

  function normalizeHeader(value) { return String(value || "").trim().toLowerCase().replace(/[\s_／/()-]/g, ""); }
  function findColumn(headers, aliases) { return headers.findIndex(header => aliases.includes(header)); }
  function number(value) {
    const parsed = Number(String(value || "").replace(/[,$NT＄元\s]/gi, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function date(value) {
    const normalized = String(value || "").trim().replace(/[./]/g, "-");
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : normalized.slice(0, 10);
  }
  function entriesFromCsv(source, options = {}) {
    const rows = parseCsv(source);
    if (rows.length < 2) throw new Error("CSV 沒有可匯入的資料");
    const headers = rows[0].map(normalizeHeader);
    const columns = {
      date: findColumn(headers, ["date", "日期", "交易日期", "入帳日期"]),
      type: findColumn(headers, ["type", "類型", "收支", "交易類型"]),
      amount: findColumn(headers, ["amount", "金額", "交易金額"]),
      income: findColumn(headers, ["income", "收入", "存入", "貸方"]),
      expense: findColumn(headers, ["expense", "支出", "提出", "借方"]),
      category: findColumn(headers, ["category", "分類", "收支分類"]),
      item: findColumn(headers, ["item", "項目", "品項"]),
      account: findColumn(headers, ["account", "帳戶", "卡片", "付款帳戶", "扣款帳號", "銀行帳戶"]),
      currency: findColumn(headers, ["currency", "幣別", "交易幣別", "貨幣"]),
      purchaseRegion: findColumn(headers, ["purchaseregion", "刷卡地區", "交易地區", "國內外"]),
      merchant: findColumn(headers, ["merchant", "商家", "來源", "交易說明", "摘要", "交易內容", "備註摘要"]),
      note: findColumn(headers, ["note", "備註", "說明"])
    };
    Object.entries(options.mapping || {}).forEach(([key,header])=>{if(key in columns)columns[key]=headers.indexOf(normalizeHeader(header));});
    if (columns.date < 0 || (columns.amount < 0 && columns.income < 0 && columns.expense < 0)) throw new Error("CSV 至少需要日期與金額欄位");
    return rows.slice(1).map(cells => {
      const income = columns.income >= 0 ? number(cells[columns.income]) : 0;
      const expense = columns.expense >= 0 ? number(cells[columns.expense]) : 0;
      const signedAmount = columns.amount >= 0 ? number(cells[columns.amount]) : income || expense;
      const typeText = columns.type >= 0 ? String(cells[columns.type] || "").toLowerCase() : "";
      const type = /收入|income|存入|貸方/.test(typeText) || income > 0 ? "income" : "expense";
      const cell = key => columns[key] >= 0 ? cells[columns[key]] || "" : "";
      const regionText = String(cell("purchaseRegion") || "").toLowerCase();
      return { date: date(cell("date")), type, amount: Math.abs(signedAmount), category: cell("category"), item: cell("item"), account: cell("account"), currency: String(cell("currency")||"").toUpperCase(), purchaseRegion: /國外|foreign|海外/.test(regionText)?"foreign":"domestic", merchant: cell("merchant"), note: cell("note"), importSource: "CSV" };
    }).filter(row => row.date || row.amount);
  }

  const KEYWORDS = [
    [/薪資|薪水|salary|payroll/i,"薪資"],[/利息|interest/i,"利息收入"],[/股息|配息|dividend/i,"投資收入"],
    [/全聯|家樂福|超市|市場|食品/i,"日用品"],[/uber|計程車|高鐵|台鐵|捷運|加油|停車/i,"交通"],
    [/醫院|診所|藥局|醫療/i,"醫療"],[/電信|水費|電費|瓦斯|網路/i,"生活繳費"],[/餐|咖啡|便當|早餐|午餐|晚餐|food/i,"餐飲"],
    [/飯店|旅館|航空|旅行|booking/i,"旅遊"],[/保險|insurance/i,"保險"],[/學費|課程|書店/i,"教育"]
  ];
  function suggestCategory(row, ledger = {}) {
    if (row.category) return row.category;
    const merchant=String(row.merchant||row.note||"").trim();
    const custom=(ledger.categoryRules||[]).find(rule=>rule.type===(row.type==="income"?"income":"expense")&&merchant.toLowerCase().includes(String(rule.keyword||"").toLowerCase()));
    if (custom?.category) return custom.category;
    const learned=(ledger.entries||[]).filter(item=>item.type===row.type&&item.category&&item.merchant).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).find(item=>merchant&&String(item.merchant).toLowerCase()===merchant.toLowerCase());
    if (learned) return learned.category;
    const keyword=KEYWORDS.find(([pattern])=>pattern.test(merchant));
    if (keyword) return keyword[1];
    return row.type==="income"?"其他收入":"其他支出";
  }
  function prepareEntries(rows, ledger = {}, options = {}) {
    const activeAccounts=(ledger.accounts||[]).filter(row=>!row.archived),defaultAccount=options.defaultAccount||activeAccounts[0]?.name||"";
    return rows.map(row=>{
      const account=row.account || defaultAccount;
      const accountCurrency=(ledger.accounts||[]).find(item=>item.name===account)?.currency||"TWD";
      return {...row,account,category:suggestCategory(row,ledger),currency:row.currency||accountCurrency,importSuggested:!row.category};
    });
  }
  function previewCsv(source, ledger = {}, options = {}) {
    const signature=row=>[String(row.date||"").slice(0,10),row.type==="income"?"income":"expense",Math.round(Number((row.transactionAmount??row.amount)||0)*100)/100,String(row.account||"").trim(),String(row.merchant||"").trim(),String(row.item||"").trim()].join("|").toLocaleLowerCase("zh-TW");
    const existing=new Set((ledger.entries||[]).map(signature)),seen=new Set(existing);
    const rows=prepareEntries(entriesFromCsv(source,options),ledger,options).map(row=>{const key=signature(row),importDuplicate=seen.has(key);seen.add(key);return{...row,importDuplicate}});
    return {rows,stats:{total:rows.length,suggested:rows.filter(row=>row.importSuggested).length,duplicates:rows.filter(row=>row.importDuplicate).length,income:rows.filter(row=>row.type==="income").length,expense:rows.filter(row=>row.type!=="income").length}};
  }

  const fields = { date:"日期",type:"類型",amount:"金額",income:"存入",expense:"提出",merchant:"商家／摘要",category:"分類",account:"帳戶",currency:"幣別",code:"代號",market:"市場",shares:"股數",price:"單價",fee:"手續費",tax:"稅",note:"備註" };
  const templates = [
    {id:"bank",name:"銀行收支",kind:"entries",mapping:{date:"交易日期",income:"存入",expense:"提出",merchant:"摘要",account:"帳戶",currency:"幣別"}},
    {id:"card",name:"信用卡帳單",kind:"entries",mapping:{date:"交易日期",amount:"交易金額",merchant:"交易說明",account:"卡片",currency:"幣別"}},
    {id:"broker",name:"券商交易",kind:"trades",mapping:{date:"日期",type:"買賣",code:"代號",market:"市場",shares:"股數",price:"單價",fee:"手續費",tax:"稅",account:"帳戶",currency:"幣別"}}
  ];
  function parseWorkbench(source, ledger, options={}) {
    const csv=parseCsv(source),headers=csv[0]||[],mapping=options.mapping||{},kind=options.kind||"entries";
    if(kind!=="trades")return prepareEntries(entriesFromCsv(source,{mapping}),ledger,options);
    const cell=(cells,key)=>cells[headers.indexOf(mapping[key]||fields[key])]||"";
    return csv.slice(1).map(cells=>({date:date(cell(cells,"date")),type:/sell|賣/i.test(cell(cells,"type"))?"sell":"buy",code:cell(cells,"code").trim().toUpperCase(),market:cell(cells,"market")||"TW",shares:number(cell(cells,"shares")),price:number(cell(cells,"price")),fee:number(cell(cells,"fee")),tax:number(cell(cells,"tax")),account:cell(cells,"account")||options.defaultAccount||"",currency:cell(cells,"currency")||"TWD",note:cell(cells,"note"),importSource:"券商 CSV"}));
  }
  function assess(rows, bundle, kind="entries") {
    const existing=kind==="trades"?bundle.assets.purchaseRecords:bundle.ledger.entries,seen=new Set();
    const signature=r=>kind==="trades"?[r.date,r.type,r.code,r.market,r.currency,r.shares,r.price,r.fee||0,r.tax||0,r.account||r.cashAccount||""].join("|"):[r.date,r.type,r.transactionAmount??r.amount,r.transactionCurrency||r.currency||r.accountCurrency||"TWD",r.account,r.merchant||"",r.item||""].join("|");
    return rows.map((r,index)=>{
      const row={...r},account=bundle.ledger.accounts.find(a=>a.name===row.account&&!a.archived),key=signature(row),match=existing.find(e=>signature(e)===key),repeated=seen.has(key);seen.add(key);
      let error=!window.FinanceIntelligence.validDate(row.date)?"日期無效":!account?"帳戶不存在或已封存":!/^[A-Z]{3}$/.test(row.currency||"")?"幣別無效":"";
      if(kind==="trades"&&(!row.code||!['TW','US','FUND','USD_FUND'].includes(row.market)||!['buy','sell'].includes(row.type)||!(Number(row.shares)>0)||!(Number(row.price)>0)||Number(row.fee)<0||Number(row.tax)<0))error="請確認代號、市場、股數、價格與費用";
      if(kind!=="trades"&&(!(Number(row.amount)>0)||!['income','expense'].includes(row.type)))error="請確認金額及收支類型";
      const candidates=kind==="trades"?[]:existing.filter(e=>e.account===row.account&&e.type===row.type&&(e.transactionCurrency||e.accountCurrency||"TWD")===row.currency&&Math.abs(Date.parse(e.date)-Date.parse(row.date))<=3*86400000&&Math.abs(Number(e.transactionAmount??e.amount)-Number(row.amount))<=Math.max(10,Number(row.amount)*0.02)).map(e=>({id:e.id,date:e.date,merchant:e.merchant,amount:Number(e.transactionAmount??e.amount),difference:Number(row.amount)-Number(e.transactionAmount??e.amount)}));
      const status=error?"待確認":match?"配對":repeated?"疑似重複":candidates.length?"待確認":"新增";
      return {...row,index,status,error,matchId:match?.id||"",candidates,action:row.action||(match?"match":repeated?"skip":status==="新增"?"add":"review")};
    });
  }
  function saveTemplate(values) {
    if(!String(values.name||"").trim())throw new Error("請輸入範本名稱");
    const b=window.FinanceCore.load();b.ledger.importTemplates ||= [];
    const row={id:`template-${Date.now()}`,name:String(values.name).trim(),kind:values.kind,mapping:values.mapping,createdAt:new Date().toISOString()};b.ledger.importTemplates.push(row);window.FinanceCore.persist(b.ledger,b.assets,"儲存匯入欄位範本");return row;
  }
  function commit(rows, kind, source) {
    const core=window.FinanceCore,b=core.load(),checked=assess(rows,b,kind),selected=checked.filter(r=>r.action!=="skip");
    if(selected.some(r=>r.error||!['add','match'].includes(r.action)))throw new Error("請先修正或略過所有待確認紀錄");
    const matches=selected.filter(r=>r.action==="match").map(row=>{const id=row.selectedMatchId||row.matchId;if(!id||(id!==row.matchId&&!row.candidates.some(c=>c.id===id)))throw new Error("請選擇有效的配對紀錄");const original=(kind==="trades"?b.assets.purchaseRecords:b.ledger.entries).find(r=>r.id===id);if(!original)throw new Error("配對紀錄已變更，請重新檢查");return {kind,matchedId:id,date:row.date,account:row.account,currency:row.currency,statementAmount:Number(row.amount||0),recordedAmount:Number(original.transactionAmount??original.amount??0),difference:Number(row.amount||0)-Number(original.transactionAmount??original.amount??0),importSource:source};});
    const additions=selected.filter(r=>r.action==="add").map(r=>({...r,importSource:source}));
    const result=kind==="trades"?core.importTradeRows(additions,matches):core.importEntries(additions,matches);
    return {...result,matched:selected.filter(r=>r.action==="match").length,skipped:checked.filter(r=>r.action==="skip").length};
  }
  window.FinanceImport = Object.freeze({ parseCsv, entriesFromCsv, suggestCategory, prepareEntries, previewCsv, fields, templates, parseWorkbench, assess, saveTemplate, commit });
})();
