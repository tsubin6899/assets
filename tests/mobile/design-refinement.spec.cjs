const {test,expect}=require('@playwright/test');
for(const width of [390,1280])test('design navigation, compact metrics and dated chart '+width,async({page})=>{
 await page.setViewportSize({width,height:844});await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('/finance-center.html#investments/holdings');await page.locator('#holdingForm').waitFor();
 if(width===390){const cards=await page.locator('#app>.four-col .metric-card').evaluateAll(es=>es.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})));expect(cards[0].y).toBe(cards[1].y);expect(cards[0].x).not.toBe(cards[1].x);await page.locator('#sectionPicker').selectOption('journal');await expect(page.locator('#decisionJournalForm')).toBeVisible();}
 else{await page.getByRole('button',{name:'全部分頁',exact:true}).click();await page.locator('#allSectionTabs [data-tab=journal]').click();await expect(page.locator('#decisionJournalForm')).toBeVisible();await expect(page.locator('#allSectionTabs')).toBeHidden();}
 await page.getByRole('button',{name:'開啟資料工具'}).click();await expect(page.locator('#cloudEmail')).toBeVisible();await page.locator('#dataTools [data-go="analysis/data"]').click();await expect(page).toHaveURL(/analysis\/data/);await expect(page.locator('#dataTools')).toBeHidden();
 await page.evaluate(()=>{const {ledger,assets}=FinanceCore.load();assets.assetSnapshots=[{date:'2026-01-01',net:100},{date:'2026-01-02',net:150},{date:'2026-01-11',net:200}];FinanceCore.persist(ledger,assets,'test snapshots');});
 await page.goto('/finance-center.html#analysis/trends');const chart=page.locator('.snapshot-figure');await expect(chart).toContainText('不代表投資報酬');const x=await chart.locator('circle').evaluateAll(es=>es.map(e=>+e.getAttribute('cx')));expect((x[1]-x[0])/(x[2]-x[0])).toBeCloseTo(.1,3);await chart.locator('summary').click();await expect(chart.locator('tbody tr')).toHaveCount(3);await expect(page.locator('[data-fi-form=valuation]')).toBeHidden();await page.getByText('補齊歷史估值與匯率',{exact:true}).click();await expect(page.locator('[data-fi-form=valuation]')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/design-refinement-'+width+'.png',fullPage:true});
});
test('all finance routes remain reachable without overflow',async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/finance-center.html');await page.locator('#app h2').first().waitFor();const routes=await page.evaluate(()=>Object.entries(FinanceCenterRoutes).flatMap(([d,r])=>r.tabs.map(([t])=>d+'/'+t)));
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});for(const route of routes){await page.goto('/finance-center.html#'+route);await page.locator('#app h2').first().waitFor();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+' '+route).toBeTruthy();}}
 expect(errors).toEqual([]);
});
