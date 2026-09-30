import utils from '../server/push-utils.cjs';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{
    const env=utils.configuration(),token=String(req.headers.authorization||'');if(!/^Bearer \S+$/.test(token))return res.status(401).json({error:'請先登入雲端'});
    const userResponse=await fetch(env.SUPABASE_URL+'/auth/v1/user',{headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:token},signal:AbortSignal.timeout(10000)});
    if(!userResponse.ok)return res.status(401).json({error:'登入已過期'});const user=await userResponse.json();if(!user.id)return res.status(401).json({error:'登入已過期'});
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    if(!utils.validSubscription(body.subscription))return res.status(400).json({error:'無效推播訂閱'});
    const id=utils.subscriptionId(user.id,body.subscription.endpoint);
    if(body.remove)await utils.rest('finance_push_subscriptions?id=eq.'+id+'&user_id=eq.'+encodeURIComponent(user.id),{method:'DELETE'});
    else {
      const existing=await utils.rest('finance_push_subscriptions?select=id&user_id=eq.'+encodeURIComponent(user.id)+'&limit=11');
      if(existing.length>=10&&!existing.some(row=>row.id===id))return res.status(429).json({error:'最多啟用 10 個裝置，請先停止不用的裝置提醒'});
      await utils.rest('finance_push_subscriptions?user_id=neq.'+encodeURIComponent(user.id)+'&subscription-%3E%3Eendpoint=eq.'+encodeURIComponent(body.subscription.endpoint),{method:'DELETE'});
      await utils.rest('finance_push_subscriptions?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id,user_id:user.id,subscription:body.subscription,updated_at:new Date().toISOString()})});
    }
    return res.status(200).json({ok:true});
  }catch(error){return res.status(503).json({error:error.message==='背景推播服務尚未完成設定'?error.message:'背景提醒服務暫時無法使用'});}
}
