const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),output=path.join(root,'public');
const result=spawnSync(process.execPath,[path.join(root,'tests/run-tests.cjs')],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
fs.mkdirSync(output,{recursive:true});
// Explicit public assets only; tests, SQL, dependencies and server code stay out.
for(const name of fs.readdirSync(root))if(/\.(html|js|json|webmanifest)$/.test(name)&&name!=='package.json')fs.copyFileSync(path.join(root,name),path.join(output,name));
fs.cpSync(path.join(root,'icons'),path.join(output,'icons'),{recursive:true});
console.log('Verified static assets prepared in public/');
