// Asset + SHA pin taken from OpenScreen v1.11.0 scripts/fetch-ffmpeg.mjs (MIT).
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const archive = path.join(root, 'output/ffmpeg-lgpl-8.1.zip')
const out = path.join(root, 'resources/video')
const sha = '089e4169e93b2b3f3acbfced3c0704d24276a225641bdda04d796d28b07a2a38'
const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-31-14-10/ffmpeg-n8.1.2-34-g9b6c8969e0-win64-lgpl-8.1.zip'
async function main() {
  fs.mkdirSync(path.dirname(archive), { recursive: true }); fs.mkdirSync(out, { recursive: true })
  if (!fs.existsSync(archive)) {
    const response = await fetch(url); if (!response.ok) throw new Error('FFmpeg download: ' + response.status)
    const { pipeline } = require('node:stream/promises'); const { Readable } = require('node:stream')
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive))
  }
  const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
  if (hash.digest('hex') !== sha) throw new Error('FFmpeg SHA256 mismatch; no extraction performed')
  const temp = path.join(root, 'output/ffmpeg-extracted'); fs.mkdirSync(temp, { recursive: true })
  execFileSync('tar.exe', ['-xf', archive, '-C', temp], { windowsHide: true })
  const dir = fs.readdirSync(temp).find(x => x.startsWith('ffmpeg-'))
  for (const name of ['ffmpeg.exe','ffprobe.exe']) fs.copyFileSync(path.join(temp,dir,'bin',name),path.join(out,name))
  const license = execFileSync(path.join(out,'ffmpeg.exe'), ['-hide_banner','-L'], { encoding:'utf8', windowsHide:true })
  if (!license.includes('Lesser General Public License')) throw new Error('Expected LGPL FFmpeg')
  fs.writeFileSync(path.join(out, 'FFMPEG-LICENSE.txt'), license)
  const files=fs.readdirSync(path.join(temp,dir));const fullLicense=files.find(f=>/^LICENSE/i.test(f))
  if(!fullLicense)throw Error('Missing full FFmpeg license')
  fs.copyFileSync(path.join(temp,dir,fullLicense),path.join(out,'FFMPEG-FULL-LICENSE.txt'))
  fs.copyFileSync(path.join(root,'native/openscreen-wgc/LICENSE'),path.join(out,'OpenScreen-MIT-LICENSE.txt'))
  fs.copyFileSync(path.join(root,'VIDEO-THIRD-PARTY-NOTICES.md'),path.join(out,'THIRD-PARTY-NOTICES.md'))
  const buildResult=require('node:child_process').spawnSync(path.join(out,'ffmpeg.exe'),['-hide_banner','-buildconf'],{encoding:'utf8',windowsHide:true}); const build=(buildResult.stdout||'')+(buildResult.stderr||'')
  fs.writeFileSync(path.join(out,'FFMPEG-BUILD-CONFIG.txt'),build)
  console.log('Verified LGPL FFmpeg and ffprobe ready.')
}
main().catch(e => { console.error(e); process.exitCode=1 })
