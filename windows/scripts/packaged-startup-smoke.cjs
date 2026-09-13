const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process')
const out=path.resolve(__dirname,'../output/packaged-startup-'+Date.now()),profile=path.join(out,'profile'),marker=path.join(out,'result.json')
fs.mkdirSync(profile,{recursive:true});fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({hotkeys:Object.fromEntries(['ocr','capture','copy','pin','long','translate'].map((k,i)=>[k,`Ctrl+Alt+Shift+F${i+1}`]))}))
const env={...process.env,TA_SMOKE_FILE:marker,TA_E2E_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(path.resolve(__dirname,'../release/win-unpacked/拓 Ta.exe'),[],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log=''
child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d)
const timer=setTimeout(()=>{child.kill();console.error('Startup timeout');process.exitCode=1},30000)
child.on('error',e=>{clearTimeout(timer);console.error(e);process.exitCode=1})
child.on('exit',()=>{clearTimeout(timer);fs.writeFileSync(path.join(out,'log.txt'),log);try{const r=JSON.parse(fs.readFileSync(marker,'utf8'));if(!r.ready||!r.packaged||r.version!=='1.6.0'||Object.values(r.hotkeyStatus).some(v=>v!==true))throw Error('Startup validation failed');console.log(JSON.stringify({...r,output:out}))}catch(e){console.error(e);process.exitCode=1}})
