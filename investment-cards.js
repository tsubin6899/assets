(function(){
  'use strict';
  const titles={portfolioLab:['每日投資摘要','資料核對工作台','每日資產歷史與變化解釋','投資決策日誌','產業分類與 ETF 穿透曝險','備份與服務健康中心'],investmentOperations:[],fubonReview:[]};
  const tableTitles={review:['待核對事項'],history:['每日估值紀錄'],journal:['決策與檢討紀錄'],exposure:['產業分布','穿透個股','ETF 資料覆蓋','ETF 重疊比較'],performance:['交易費用明細','整合提醒'],calendar:['交割與股息日程']};
  function layout(section,state){
    if(!section||section.dataset.cardsReady)return;
    section.dataset.cardsReady='1';section.classList.add('investment-card-layout');
    const nodes=[...section.childNodes];let card=null,index=0;
    const make=(name,kind='')=>{const el=document.createElement('div');el.className='investment-card '+kind;if(name){const h=document.createElement('h4');h.textContent=name;el.append(h);}section.append(el);return el;};
    for(const node of nodes){
      if(node.nodeType===3&&!node.textContent.trim()){node.remove();continue;}
      if(node.nodeType!==1){(card||=make()).append(node);continue;}
      const tag=node.tagName;
      if(tag==='H3'){card=make(null,'investment-card-intro');card.append(node);continue;}
      if(tag==='DIV'&&node.querySelector(':scope > table')){const heads=[...node.querySelectorAll('thead th')].map(x=>x.textContent);const inferred=heads.includes('優先級')?'整合提醒清單':heads.includes('本年手續費')?'交易費用明細':heads.includes('類型')?'交割與股息日程':'資料明細';const target=make(tableTitles[state.tab]?.[index++]||inferred,'investment-card-data');node.classList.add('investment-table-scroll');const count=node.querySelectorAll('tbody tr').length;if(count>12&&heads.includes('優先級')){const details=document.createElement('details'),label=document.createElement('summary');label.textContent=`查看全部 ${count} 筆提醒`;details.append(label,node);target.append(details);}else target.append(node);card=null;continue;}
      if(tag==='FORM'){card=make('新增決策紀錄','investment-card-form');card.append(node);card=null;continue;}
      if(tag==='DETAILS'){const target=make(null,'investment-card-details');target.append(node);card=null;continue;}
      if(tag==='P'&&!node.id&&!node.children.length&&node.textContent.includes('｜')){
        const bits=node.textContent.split('｜').map(s=>s.trim()).filter(Boolean);
        if(bits.length>1&&bits.every(bit=>bit.length<65)&&!node.textContent.includes('資料產出')){const target=make(null,'investment-metrics');for(const bit of bits){const metric=document.createElement('div');metric.className='investment-metric';metric.textContent=bit;target.append(metric);}node.remove();card=null;continue;}
      }
      (card||=make(null,'investment-card-actions')).append(node);
    }
  }
  function decorate(app,state){
    const summary=app.querySelector('#portfolioLab');if(summary&&state.tab==='portfolio'){const first=app.querySelector('#fubonReview, #investmentOperations');if(first)first.before(summary);}
    for(const id of Object.keys(titles)){const section=app.querySelector('#'+id);layout(section,state);if(section&&!section._cardObserver){section._cardObserver=new MutationObserver(()=>{if(!section.querySelector(':scope > .investment-card')){delete section.dataset.cardsReady;layout(section,state);}});section._cardObserver.observe(section,{childList:true});}}
    if(state.domain==='investments'&&state.tab==='portfolio')overview(app);
  }
  function overview(app){
    if(app.querySelector('#investmentOverviewTools'))return;
    const b=window.FinanceCore.load(),issues=window.PortfolioLab.quality(b),plans=window.InvestmentOperations.calendar(b).filter(r=>r.source==='手動確認日程'&&!r.completed);
    const host=document.createElement('section');host.id='investmentOverviewTools';host.className='portfolio-overview-tools';
    const head=document.createElement('div');head.className='portfolio-attention';
    const title=document.createElement('h3');title.textContent='投資管理';
    const note=document.createElement('p');note.textContent=`${issues.length?`有 ${issues.length} 項資料待核對`:'目前沒有資料核對待辦'} · ${plans.length} 筆未完成日程`;
    head.append(title,note);host.append(head);
    const grid=document.createElement('nav');grid.className='portfolio-tool-grid';grid.setAttribute('aria-label','投資管理工具');
    const links=[['review','資料核對','處理缺漏、重複與股數差異','✓'],['history','資產歷史','查看估值與資金流變化','↗'],['journal','決策日誌','記錄投資理由與事後檢討','≡'],['exposure','產業與 ETF','查看集中度與共同持股','◫'],['health','服務與備份','查看連線狀態與保存資料','◎'],['trades','交易紀錄','查閱買賣與成交匯入','⇄']];
    for(const [route,label,desc,icon] of links){const a=document.createElement('a');a.href='#investments/'+route;const mark=document.createElement('span');mark.className='portfolio-tool-icon';mark.textContent=icon;const text=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=label;small.textContent=desc;text.append(strong,small);a.append(mark,text);grid.append(a);}host.append(grid);
    const sections=[['portfolioLab','每日摘要與行情','損益、待辦數字及持股行情更新'],['fubonReview','富邦持股對帳','載入快照、確認帳戶與預覽成交匯入'],['investmentOperations','日程、績效與提醒','交割股息、費用明細及完整提醒清單']];
    const first=app.querySelector('#portfolioLab, #fubonReview, #investmentOperations');if(first)first.before(host);else app.append(host);
    for(const [id,label,desc] of sections){const section=app.querySelector('#'+id);if(!section)continue;const details=document.createElement('details');details.className='portfolio-overview-disclosure';const summary=document.createElement('summary'),text=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=label;small.textContent=desc;text.append(strong,small);const arrow=document.createElement('span');arrow.className='portfolio-disclosure-arrow';arrow.textContent='＋';arrow.setAttribute('aria-hidden','true');summary.append(text,arrow);details.append(summary,section);details.addEventListener('toggle',()=>{arrow.textContent=details.open?'−':'＋';});host.append(details);section.style.marginTop='0';}
  }
  window.InvestmentCards={decorate};
})();
