// Installs only inside the isolated output folder; no cloud write or login.
const fs=require('fs'),path=require('path'),{FeishuSetup}=require('../dist-electron/sop/feishu-setup'),{runCli}=require('../dist-electron/sop/feishu')
const root=path.resolve(__dirname,'../output/cli-install-'+Date.now());fs.mkdirSync(root,{recursive:true});let settings={executable:'',profile:'',parentToken:''}
async function main(){
if(process.versions.electron)await require('electron').app.whenReady();
const setup=new FeishuSetup(root,()=>settings,s=>settings=s,runCli,process.versions.electron?require('electron').net.fetch:fetch),discover=setup.discover.bind(setup);let first=true;setup.discover=async()=>{if(first){first=false;return {installed:false,version:'',profiles:[],settings}}return discover()}
await setup.install().then(d=>{if(!d.installed||!d.settings.executable.startsWith(root))throw Error('Isolated installation not detected');fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,version:d.version,sha256Verified:true,profileNamesDetected:d.profiles.length,isolatedInstall:true,cloudWrite:false},null,2));console.log(JSON.stringify({passed:true,version:d.version,output:root}))}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(process.versions.electron)require('electron').app.exit(process.exitCode||0)})
}
main()
