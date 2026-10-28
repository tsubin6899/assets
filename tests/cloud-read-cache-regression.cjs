const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('finance-center.html','utf8'),source=html.slice(html.indexOf('    let cloudRowCache=null;'),html.indexOf('    let cloudSyncBusy=false'));
let profile={data:{accountingLedger:{entries:[{id:'one',amount:20}]}},updated_at:'2026-10-28T01:00:00Z'},failure=null;
const requests=[];let selected='';
const request={select:v=>{selected=v;requests.push(v);return request;},eq:()=>request,maybeSingle:async()=>({data:profile?(selected==='updated_at'?{updated_at:profile.updated_at}:profile):null,error:failure})};
const c=vm.createContext({supabaseClient:{from:()=>request},cloudUser:{id:'u'}});vm.runInContext(html.slice(html.indexOf('    function sameCloudVersion'),html.indexOf('    let cloudRowCache')),c);vm.runInContext(source,c);
(async()=>{
 await c.fetchCloudRow();await c.fetchCloudRow();assert.deepEqual(requests,['data,updated_at','updated_at']);
 assert.equal(c.sameCloudVersion('2026-10-28T01:00:00.000Z','2026-10-28T01:00:00+00:00'),true);assert.equal(c.sameCloudVersion('2026-10-28T01:00:00.000123Z','2026-10-28T01:00:00.000456Z'),false);
 profile={...profile,updated_at:'2026-10-28T02:00:00Z'};await c.fetchCloudRow();assert.deepEqual(requests.slice(-2),['updated_at','data,updated_at']);
 failure={message:'statement timeout'};await assert.rejects(c.fetchCloudRow(),e=>e.message==='statement timeout');failure=null;
 profile=null;assert.equal(await c.fetchCloudRow(),null);profile={data:{},updated_at:'2026-10-28T03:00:00Z'};c.cloudUser={id:'another'};await c.fetchCloudRow();assert.equal(requests.at(-1),'data,updated_at');
 console.log('Cloud reads OK: unchanged versions avoid full downloads, newer versions fetched, timeouts propagate, cache isolated by user');
})().catch(e=>{console.error(e);process.exitCode=1;});
