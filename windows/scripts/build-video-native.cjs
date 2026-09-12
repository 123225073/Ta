const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe'
const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
if (!vs) throw new Error('需要 Visual Studio C++ Build Tools。')
const installations = execFileSync(vswhere, ['-all', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8' }).trim().split(/\r?\n/)
function findBuildTool(relative, override) {
  if (override) return override
  for (const installation of [vs, ...installations]) {
    const candidate = path.join(installation, 'Common7/IDE/CommonExtensions/Microsoft/CMake', relative)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('需要安装 Visual Studio CMake/Ninja 组件，或设置 TA_CMAKE、TA_NINJA。')
}
const cmake = findBuildTool('CMake/bin/cmake.exe', process.env.TA_CMAKE)
const ninja = findBuildTool('Ninja/ninja.exe', process.env.TA_NINJA)
const source = path.join(root, 'native/openscreen-wgc')
const build = path.join(source, 'build')
fs.mkdirSync(build, { recursive: true })
const script = path.join(build, 'build-ta.cmd')
fs.writeFileSync(script, [
  '@echo off', 'set VSLANG=1033', `call "${vs}\\VC\\Auxiliary\\Build\\vcvarsall.bat" x64`, 'if errorlevel 1 exit /b %errorlevel%',
  `"${cmake}" -S "${source}" -B "${build}" -G Ninja "-DCMAKE_MAKE_PROGRAM=${ninja}" -DCMAKE_BUILD_TYPE=Release`,
  'if errorlevel 1 exit /b %errorlevel%', `"${cmake}" --build "${build}" --target wgc-capture audio_sample_utils_test`,
  'exit /b %errorlevel%', '',
].join('\r\n'))
execFileSync('cmd.exe', ['/d', '/c', script], { stdio: 'inherit', windowsHide: true })
execFileSync(path.join(build, 'audio_sample_utils_test.exe'), [], { stdio: 'inherit', windowsHide: true })
const dest = path.join(root, 'resources/video')
fs.mkdirSync(dest, { recursive: true })
fs.copyFileSync(path.join(build, 'wgc-capture.exe'), path.join(dest, 'ta-recorder.exe'))
console.log('Ta native recorder built from OpenScreen v1.11.0.')
