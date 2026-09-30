const {test,expect}=require('@playwright/test');
for(const viewport of [{width:390,height:844},{width:360,height:800},{width:430,height:932}])test(`quick entry fits ${viewport.width}x${viewport.height}`,async({page})=>{
  await page.setViewportSize(viewport);
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();return route.continue();});
  await page.goto('/finance-center.html#daily/quick');await page.locator('#quickEntryForm').waitFor();
  await page.evaluate(()=>{FinanceCore.addAccount({name:'測試現金',type:'現金',currency:'TWD',openingBalance:1000});});
  await page.reload();const form=page.locator('#quickEntryForm');await expect(form).toBeVisible();
  const bounds=await page.evaluate(()=>{const rect=document.querySelector('#quickEntryForm button[type=submit]').getBoundingClientRect(),nav=document.querySelector('.secondary-nav').getBoundingClientRect();return {bottom:rect.bottom,navTop:nav.top,width:document.documentElement.scrollWidth,viewport:innerWidth}});
  expect(bounds.width).toBeLessThanOrEqual(bounds.viewport);expect(bounds.bottom).toBeLessThanOrEqual(bounds.navTop);
  await form.locator('[name=amount]').fill('80');await form.locator('[name=merchant]').fill('測試早餐');await form.locator('[name=continueEntry]').check();await form.locator('[type=submit]').click();
  await expect(page.locator('#quickEntryForm [name=amount]')).toHaveValue('');await expect(page.locator('[data-experience-undo]')).toBeVisible();
  await page.locator('[data-experience-undo]').click();expect(await page.evaluate(()=>FinanceCore.load().ledger.entries.filter(r=>r.merchant==='測試早餐').length)).toBe(0);
  await page.evaluate(()=>FinanceStorage.save());await page.goto('/finance-center.html#analysis/data');await page.locator('[data-experience-verify]').click();await expect(page.locator('#toast')).toContainText('校驗');
  await page.goto('/finance-center.html#daily/quick');await page.screenshot({path:`test-results/mobile-${viewport.width}.png`,fullPage:true});
  await page.setViewportSize({width:viewport.width,height:500});await page.locator('#quickEntryForm [name=amount]').focus();await expect(page.locator('.secondary-nav')).toBeHidden();await page.locator('#quickEntryForm [type=submit]').scrollIntoViewIfNeeded();await expect(page.locator('#quickEntryForm [type=submit]')).toBeInViewport();
});

test('bank pairing and conflict selection operate on synthetic data',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/finance-center.html#daily/quick');await page.locator('#quickEntryForm').waitFor();
  const details=await page.evaluate(()=>{
    FinanceCore.addAccount({name:'測試銀行',type:'銀行帳戶',currency:'TWD',openingBalance:10000});FinanceCore.addAccount({name:'測試卡片',type:'信用卡',currency:'TWD',openingBalance:0});
    const month=FinanceCore.monthOf(),date=month+'-02';FinanceCore.addEntry({date,type:'expense',amount:100,account:'測試卡片',merchant:'測試商店',purchaseRegion:'foreign'});
    FinanceCore.addCreditBill({card:'測試卡片',billMonth:month,amount:102,payAccount:'測試銀行',dueDate:month+'-28'});
    return {date,billId:FinanceCore.load().ledger.creditBills.at(-1).id};
  });
  await page.reload();await page.locator('#quickEntryForm [name=account]').selectOption({label:'測試卡片　｜　TWD'});await expect(page.locator('[data-card-region]')).toBeVisible();
  await page.goto('/finance-center.html#accounts/credit');await page.locator(`[data-experience-bill="${details.billId}"]`).click();
  await page.locator('[data-experience-bank] [name=source]').fill(`日期,商家,金額\n${details.date},測試商店,100`);await page.locator('[data-experience-bank] button').click();
  await expect(page.locator('[data-experience-matches]')).toBeVisible();await page.locator('[data-experience-matches] button').click();
  expect(await page.evaluate(id=>Object.keys(FinanceCore.load().ledger.creditBills.find(r=>r.id===id).bankMatches).length,details.billId)).toBe(1);
  await page.evaluate(()=>{window.testResolution=FinanceExperience.resolveSync({ledger:{entries:[{id:'fixture',amount:100}]},assets:{}},{ledger:{entries:[{id:'fixture',amount:200}]},assets:{}});});
  await page.locator('[data-resolution] select').selectOption('remote');await page.locator('[data-resolution] button').click();expect(await page.evaluate(async()=> (await window.testResolution).ledger.entries[0].amount)).toBe(200);
});
