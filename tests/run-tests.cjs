const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
for(const file of fs.readdirSync(__dirname).filter(name=>name.endsWith('-regression.js')||name.endsWith('-regression.cjs')||name.endsWith('-smoke.js')).sort()){
  const result=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}
for(const file of fs.readdirSync(root).filter(name=>name.startsWith('finance-')&&name.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',file],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);}
