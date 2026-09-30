(function () {
  "use strict";

  const KEY = "tsubin-finance-notification-state-v1";
  let checking=false,checkTimer=0,initialized=false;
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } }
  function write(value) { localStorage.setItem(KEY, JSON.stringify(value)); return value; }
  function supported() { return typeof Notification !== "undefined"; }

  async function request() {
    if (!supported()) throw new Error("此瀏覽器不支援系統通知");
    const permission = await Notification.requestPermission();
    write({ ...read(), enabled:permission === "granted", permission, updatedAt:new Date().toISOString() });
    return permission;
  }

  function taiwanDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
  async function check(alerts = []) {
    if (!supported() || Notification.permission !== "granted") return 0;
    if(checking)return 0;
    const state = read();
    const today = taiwanDate(),sent=state.sent?.date===today?state.sent.keys:[],rows=alerts.filter(row => ["danger", "warning"].includes(row.level)&&!sent.includes(row.title+'|'+row.detail)).slice(0,3);
    if(!rows.length)return 0;
    checking=true;
    try{
      const registration=await navigator.serviceWorker?.getRegistration();
      for(const row of rows){const title=row.title||'個人財務提醒',options={body:row.detail||'請開啟個人財務中心查看',tag:`tsubin-${row.title}`,data:{url:'./finance-center.html#accounts/credit'}};if(registration)await registration.showNotification(title,options);else new Notification(title,options);sent.push(row.title+'|'+row.detail);}
      write({...read(),enabled:true,permission:'granted',sent:{date:today,keys:sent.slice(-100)},lastError:''});return rows.length;
    }catch(error){write({...read(),lastError:error.message});return 0;}finally{checking=false;}
  }

  function status() { const state=read();return { ...state,supported:supported(), permission:supported()?Notification.permission:"unsupported", enabled:Boolean(state.enabled)&&supported()&&Notification.permission==='granted' }; }
  async function subscriptionRequest(token,body){if(!token)throw new Error('請先登入雲端');const response=await fetch('/api/push-subscription',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'背景提醒註冊失敗');return result;}
  async function enablePush(token){
    try{
      if(!navigator.serviceWorker||typeof PushManager==='undefined')throw new Error('此裝置不支援背景推播；iPhone 請從主畫面開啟已安裝的 App');
      const config=await fetch('/api/public-config',{cache:'no-store'}).then(r=>r.json());if(!config.pushPublicKey)throw new Error('背景推播服務尚未完成伺服器設定');
      if(await request()!=='granted')throw new Error('請允許通知權限');
      const registration=await navigator.serviceWorker.ready,key=Uint8Array.from(atob(config.pushPublicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)),subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await subscriptionRequest(token,{subscription:subscription.toJSON()});write({...read(),pushEnabled:true,pushError:''});return true;
    }catch(error){write({...read(),pushEnabled:false,pushError:error.message});throw error;}
  }
  async function disablePush(token){const registration=await navigator.serviceWorker?.getRegistration(),subscription=await registration?.pushManager.getSubscription();if(subscription){await subscriptionRequest(token,{subscription:subscription.toJSON(),remove:true});await subscription.unsubscribe();}write({...read(),pushEnabled:false,pushError:''});}
  function init(){if(initialized)return;initialized=true;const schedule=()=>{clearTimeout(checkTimer);checkTimer=setTimeout(()=>check(window.FinanceCore.insights().alerts),500)};window.addEventListener('finance-core-change',schedule);window.addEventListener('focus',schedule);setInterval(schedule,600000);}
  window.FinanceNotifications = Object.freeze({ supported, request, check, status, taiwanDate, enablePush, disablePush, init });
})();
