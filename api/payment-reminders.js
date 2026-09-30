import webpush from 'web-push';
import utils from '../server/push-utils.cjs';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(!process.env.CRON_SECRET||req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)return res.status(401).json({error:'Unauthorized'});
  try{
    const env=utils.configuration(),today=utils.taiwanDate();webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
    let sent=0,failed=0,expired=0,cursor='';
    while(true){
      const rows=await utils.rest('finance_push_subscriptions?select=*&order=id&limit=100'+(cursor?'&id=gt.'+cursor:''));if(!rows.length)break;
      for(let i=0;i<rows.length;i+=5)await Promise.all(rows.slice(i,i+5).map(async row=>{
        let claimed=false;
        try{
          if(row.last_notified_date===today)return;
          const profiles=await utils.rest('asset_dashboard_profiles?select=data&user_id=eq.'+encodeURIComponent(row.user_id)),bills=utils.dueBills(profiles[0]?.data,today);if(!bills.length)return;
          claimed=await utils.rest('rpc/claim_finance_push_reminder',{method:'POST',body:JSON.stringify({subscription_id:row.id,notification_date:today})});if(!claimed)return;
          await webpush.sendNotification(row.subscription,JSON.stringify({title:'信用卡繳款提醒',body:`有 ${bills.length} 筆帳單即將到期或已逾期，請開啟財務中心確認。`,tag:'finance-payment-'+today}),{TTL:3600,timeout:10000});sent++;
        }catch(error){
          if([404,410].includes(error.statusCode)){await utils.rest('finance_push_subscriptions?id=eq.'+row.id,{method:'DELETE'});expired++;}
          else{failed++;if(claimed)await utils.rest('finance_push_subscriptions?id=eq.'+row.id+'&last_notified_date=eq.'+today,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({last_notified_date:null})});}
        }
      }));
      cursor=rows.at(-1).id;if(rows.length<100)break;
    }
    return res.status(failed?207:200).json({ok:failed===0,sent,failed,expired,date:today});
  }catch{return res.status(503).json({error:'背景提醒服務暫時無法使用'});}
}
