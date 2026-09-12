const fs=require('node:fs'),path=require('node:path')
const dir=path.resolve(__dirname,'../resources/video')
for(const file of ['ta-recorder.exe','ffmpeg.exe','ffprobe.exe','OpenScreen-MIT-LICENSE.txt','FFMPEG-FULL-LICENSE.txt','THIRD-PARTY-NOTICES.md']){
  if(!fs.existsSync(path.join(dir,file)))throw Error(`Missing ${file}; run npm run build:video and npm run prepare:video first.`)
}
console.log('Video native tools and third-party notices are present.')
