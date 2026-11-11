const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),output=path.join(root,'public');
const result=spawnSync(process.execPath,[path.join(root,'tests/run-tests.cjs')],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
fs.mkdirSync(output,{recursive:true});
// Explicit public assets only; tests, SQL, dependencies and server code stay out.
for(const name of fs.readdirSync(root))if(/\.(html|js|css|json|webmanifest)$/.test(name)&&name!=='package.json')fs.copyFileSync(path.join(root,name),path.join(output,name));
// Serve the same finance center directly at the root and the existing app URL.
fs.copyFileSync(path.join(root,'finance-center.html'),path.join(output,'index.html'));
fs.cpSync(path.join(root,'icons'),path.join(output,'icons'),{recursive:true});
fs.copyFileSync(path.join(root,'shiguang-islands.jpg'),path.join(output,'shiguang-islands.jpg'));
fs.cpSync(path.join(root,'island-art'),path.join(output,'island-art'),{recursive:true});
console.log('Verified static assets prepared in public/');
