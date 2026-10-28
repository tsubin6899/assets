const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const values=new Map(),context={window:{dispatchEvent(){}},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},CustomEvent:class{},CompressionStream,DecompressionStream,Response,Blob,Uint8Array,btoa,atob};
vm.runInNewContext(fs.readFileSync('finance-sync.js','utf8'),context);
const S=context.window.FinanceSync;
(async()=>{
 const data={ledger:{entries:Array.from({length:2000},(_,i)=>({id:'entry-'+i,date:'2026-10-28',merchant:'早餐店／中文與特殊符號 🍵',amount:i+.5,account:'測試銀行',statementChecks:{bill:{checkedAt:'2026-10-28T01:00:00Z'}}}))},assets:{purchaseRecords:[{code:'AMAT',shares:10,price:418.8,fee:2.51,actualSettlementAmount:135919}]}};
 const history=Array.from({length:5},(_,i)=>({id:'v'+i,updatedAt:'2026-10-28T00:00:00Z',reason:'同步前版本',data}));
 const packed=await S.packCloudHistory(history);assert.equal(packed.length,5);assert.ok(JSON.stringify(packed).length<JSON.stringify(history).length);
 for(let i=0;i<5;i++){assert.equal(packed[i].id,history[i].id);assert.equal(JSON.stringify(await S.unpackCloudVersion(packed[i])),JSON.stringify(data));}
 const again=await S.packCloudHistory(packed);assert.equal(JSON.stringify(again),JSON.stringify(packed));assert.equal(JSON.stringify(await S.unpackCloudVersion(history[0])),JSON.stringify(data));
 S.setRemoteVersions(packed);assert.ok(S.read().remoteVersions.every(r=>!r.data&&!r.compressedData));
 await assert.rejects(S.unpackCloudVersion({...packed[0],compressedData:'broken'}),/驗證失敗/);
 context.CompressionStream=undefined;assert.equal(JSON.stringify(await S.packCloudHistory(history)),JSON.stringify(history));
 console.log('Cloud history OK: 5 lossless versions, Chinese and fractional amounts preserved, old versions readable, metadata stays small, corrupt restore rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
