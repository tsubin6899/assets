const sources={
  '0050':['https://www.yuantaetfs.com/product/detail/0050/ratio','元大投信'],
  '006208':['https://websys.fsit.com.tw/FubonETF/Trade/Assets.aspx?stkId=006208','富邦投信']
};
const plain=value=>value.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').trim();
export function parseFund(code,html){
  const asOf=html.match(/20\d{2}\/\d{2}\/\d{2}/)?.[0]?.replaceAll('/','-');
  if(!asOf||asOf>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'}))throw new Error('公告日期無法驗證');
  const rows=code==='0050'
    ?html.split('<div class="tr"').slice(1).map(part=>[...part.split('<div class="tbody"')[0].matchAll(/<div class="td"[^>]*>.*?<span data[^>]*>([\s\S]*?)<\/span><\/div>/g)].map(m=>plain(m[1])).slice(0,4))
    :[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c=>plain(c[1])));
  const holdings=[],seen=new Set();
  for(const row of rows){const weight=Number(row.at(-1)?.replaceAll(',','').replace('%',''));if(![4,5].includes(row.length)||!/^\d{4}$/.test(row[0])||seen.has(row[0])||!(weight>0&&weight<100))continue;seen.add(row[0]);holdings.push({code:row[0],name:row[1],market:'TW',weight});}
  const total=holdings.reduce((s,r)=>s+r.weight,0);
  if(holdings.length<5||holdings.length>60||total<50||total>100.1||(code==='006208'&&(holdings.length<40||total<90)))throw new Error('官方成分格式或權重未通過驗證');
  return {code,asOf,sourceUrl:sources[code][0],source:sources[code][1],holdings,coveragePercent:Math.round(total*10000)/10000,partial:holdings.length<40};
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const results=await Promise.allSettled(Object.entries(sources).map(async([code,[url]])=>{
    const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`${code} 官方來源 HTTP ${response.status}`);
    try{return parseFund(code,await response.text());}catch(error){throw new Error(`${code}：${error.message}`);}
  }));
  const funds=results.filter(r=>r.status==='fulfilled').map(r=>r.value),warnings=results.filter(r=>r.status==='rejected').map(r=>r.reason.message);
  res.setHeader('Cache-Control','no-store');
  return res.status(funds.length?200:502).json({funds,warnings,...(!funds.length?{error:warnings.join('；')}:{}),generatedAt:new Date().toISOString()});
}
