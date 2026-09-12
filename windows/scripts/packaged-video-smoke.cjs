const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process')
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','packaged-video-'+Date.now()),profile=path.join(out,'profile')
fs.mkdirSync(profile,{recursive:true});const marker=path.join(out,'result.json')
const exe=process.env.TA_TEST_EXE || path.join(root,'release/win-unpacked/拓 Ta.exe')
const env={...process.env,TA_E2E_USER_DATA_DIR:profile,TA_E2E_SMOKE_FILE:marker};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(exe,[],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log=''
child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d)
const timeout=setTimeout(()=>{child.kill();console.error('Packaged smoke timed out');process.exitCode=1},100000)
child.on('error',e=>{clearTimeout(timeout);console.error(e);process.exitCode=1})
child.on('exit',()=>{clearTimeout(timeout);fs.writeFileSync(path.join(out,'log.txt'),log);try{const r=JSON.parse(fs.readFileSync(marker,'utf8'));if(!r.ready)throw Error(r.error);for(const f of ['ta-recorder.exe','ffmpeg.exe','ffprobe.exe','OpenScreen-MIT-LICENSE.txt','FFMPEG-FULL-LICENSE.txt'])if(!fs.existsSync(path.join(path.dirname(exe),'resources/video',f)))throw Error('Missing '+f);console.log(JSON.stringify({ready:true,version:r.version,packaged:r.packaged,captured:r.captureSize||r.imageSize,library:r.libraryUiVerified,recordingResources:true,output:out}))}catch(e){console.error(e);process.exitCode=1}})
