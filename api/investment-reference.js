// TWSE listed-company profile. Industry codes follow TWSE securities industry classification.
const SOURCE='https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const INDUSTRIES={'01':'水泥工業','02':'食品工業','03':'塑膠工業','04':'紡織纖維','05':'電機機械','06':'電器電纜','08':'玻璃陶瓷','09':'造紙工業','10':'鋼鐵工業','11':'橡膠工業','12':'汽車工業','14':'建材營造','15':'航運業','16':'觀光餐旅','17':'金融保險','18':'貿易百貨','19':'綜合','20':'其他','21':'化學工業','22':'生技醫療業','23':'油電燃氣業','24':'半導體業','25':'電腦及週邊設備業','26':'光電業','27':'通信網路業','28':'電子零組件業','29':'電子通路業','30':'資訊服務業','31':'其他電子業','32':'文化創意業','33':'農業科技','34':'電子商務','35':'綠能環保','36':'數位雲端','37':'運動休閒','38':'居家生活'};
export function parseCompanies(rows){
 if(!Array.isArray(rows))throw new Error('證交所資料格式不符');
 const securities={};
 for(const r of rows){const code=String(r['公司代號']||'').trim(),raw=String(r['出表日期']||''),industryCode=String(r['產業別']||'').padStart(2,'0');if(!/^\d{4}$/.test(code)||!/^\d{7}$/.test(raw))continue;const asOf=String(Number(raw.slice(0,3))+1911)+'-'+raw.slice(3,5)+'-'+raw.slice(5,7);securities[code]={name:r['公司簡稱']||r['公司名稱']||code,industry:INDUSTRIES[industryCode]||'未分類',industryCode,asOf,type:'STOCK'};}
 if(!Object.keys(securities).length)throw new Error('證交所沒有有效分類資料');
 for(const code of ['0050','006208'])securities[code]={type:'ETF'};
 return {securities,source:'臺灣證券交易所上市公司基本資料',sourceUrl:SOURCE,generatedAt:new Date().toISOString()};
}
let cached=null,expires=0;
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{if(!cached||Date.now()>expires){const r=await fetch(SOURCE,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('證交所來源 HTTP '+r.status);const data=parseCompanies(await r.json());if(Object.keys(data.securities).length<500)throw new Error('分類資料筆數異常');cached=data;expires=Date.now()+3600000;}res.setHeader('Cache-Control','public, s-maxage=3600');return res.status(200).json(cached);}catch(error){res.setHeader('Cache-Control','no-store');return res.status(502).json({error:'產業分類暫時無法取得，未分類部位保留未知：'+error.message});}
}
