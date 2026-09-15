const {spawn}=require('node:child_process'),path=require('node:path')
const name=process.argv[2]||'video-capture-probe.cjs'
if(!['window-resize-smoke.cjs','video-capture-probe.cjs','video-ui-smoke.cjs','video-long-probe.cjs','sop-ui-smoke.cjs','timeline-ui-smoke.cjs','editor-interaction-smoke.cjs','annotation-ui-smoke.cjs','editor-usability-smoke.cjs','feishu-install-check.cjs'].includes(name))throw Error('Unknown test')
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(require('electron'),[path.join(__dirname,name)],{env,stdio:'inherit',windowsHide:true})
child.on('error',e=>{console.error(e);process.exitCode=1});child.on('exit',code=>{process.exitCode=code??1})
