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
  }
  window.InvestmentCards={decorate};
})();
