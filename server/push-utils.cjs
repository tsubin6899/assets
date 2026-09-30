const crypto=require('node:crypto');
const allowedHosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns.windows.com'];
function validSubscription(value){
  try{const url=new URL(value.endpoint);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&allowedHosts.some(host=>url.hostname===host||url.hostname.endsWith('.'+host))&&/^[A-Za-z0-9_-]{80,100}$/.test(value.keys?.p256dh||'')&&/^[A-Za-z0-9_-]{20,30}$/.test(value.keys?.auth||'');}catch{return false;}
}
function subscriptionId(userId,endpoint){return crypto.createHash('sha256').update(userId+'|'+endpoint).digest('hex');}
function taiwanDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function dueBills(profile,today){return (profile?.accountingLedger?.creditBills||[]).filter(bill=>{if(bill.paid||!/^\d{4}-\d{2}-\d{2}$/.test(bill.dueDate||''))return false;const delta=Math.round((Date.parse(bill.dueDate+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);return [3,1,0].includes(delta)||delta<0;});}
function configuration(){const env=process.env;if(!env.SUPABASE_URL||!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT||!env.CRON_SECRET)throw new Error('背景推播服務尚未完成設定');return env;}
async function rest(path,options={}){const env=configuration(),response=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...options,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('推播資料庫請求失敗（'+response.status+'）');return response.status===204?null:response.json();}
module.exports={validSubscription,subscriptionId,taiwanDate,dueBills,configuration,rest};
