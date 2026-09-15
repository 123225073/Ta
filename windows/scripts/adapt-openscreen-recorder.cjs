// Reproducible Ta adaptations to OpenScreen 47ab52fd0907ed07336fa1ff868e671d5d5a469f.
// Run only when updating the vendored source from the pinned research checkout.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const upstream = path.resolve(__dirname, '../../.work/openscreen')
const ref = '47ab52fd0907ed07336fa1ff868e671d5d5a469f'
let source = execFileSync('git', ['-C', upstream, 'show', `${ref}:electron/native/wgc-capture/src/main.cpp`], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
function replace(before, after) { if (!source.includes(before)) throw new Error('Upstream anchor missing: ' + before.slice(0,70)); source = source.replaceAll(before, after) }
source = '#include "ta_wave_writer.h"\n#include <mmdeviceapi.h>\n#include <functiondiscoverykeys_devpkey.h>\n#include <dwmapi.h>\n#pragma comment(lib, "dwmapi.lib")\n' + source
replace('int main(int argc, char* argv[]) {', `int wmain(int argc, wchar_t* wideArgv[]) {
    // Windows narrow argv uses the active ANSI code page, not UTF-8. Convert
    // directly from Unicode so Chinese output paths and device names survive.
    std::vector<std::string> utf8Args; for(int i=0;i<argc;i++) utf8Args.push_back(wideToUtf8(wideArgv[i]));
    std::vector<char*> argPointers; for(auto& s:utf8Args) argPointers.push_back(s.data());
    char** argv=argPointers.data();`)
replace('    CaptureConfig config;', `    if (std::string(argv[1]) == "--list-mics") {
        Microsoft::WRL::ComPtr<IMMDeviceEnumerator> e; Microsoft::WRL::ComPtr<IMMDeviceCollection> devices;
        std::cout << "["; bool comma=false;
        if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&e))) && SUCCEEDED(e->EnumAudioEndpoints(eCapture,DEVICE_STATE_ACTIVE,&devices))) {
            UINT count=0; devices->GetCount(&count); for(UINT i=0;i<count;i++) {
                Microsoft::WRL::ComPtr<IMMDevice> d; Microsoft::WRL::ComPtr<IPropertyStore> props; PROPVARIANT v; PropVariantInit(&v);
                if(SUCCEEDED(devices->Item(i,&d))&&SUCCEEDED(d->OpenPropertyStore(STGM_READ,&props))&&SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName,&v))&&v.vt==VT_LPWSTR) {
                    std::cout << (comma?",":"") << "\\"" << jsonEscape(wideToUtf8(v.pwszVal)) << "\\""; comma=true;
                } PropVariantClear(&v);
            }
        } std::cout << "]" << std::endl; return 0;
    }
    if (std::string(argv[1]) == "--display-info" && argc>3) {
        POINT pt{std::stoi(argv[2]),std::stoi(argv[3])}; MONITORINFO info{sizeof(MONITORINFO)};
        if(!GetMonitorInfoW(MonitorFromPoint(pt,MONITOR_DEFAULTTONEAREST),&info)) return 2;
        const RECT r=info.rcMonitor;
        std::cout << "{\\"x\\":" << r.left << ",\\"y\\":" << r.top << ",\\"width\\":" << r.right-r.left << ",\\"height\\":" << r.bottom-r.top << "}" << std::endl; return 0;
    }
    if (std::string(argv[1]) == "--window-info" && argc>2) {
        const HWND h=reinterpret_cast<HWND>(std::stoull(argv[2])); RECT r{};
        if(!IsWindow(h)||!GetWindowRect(h,&r)) return 2;
        // WGC includes the window frame. Keep GetWindowRect coordinates for ink alignment.
        std::cout << "{\\"x\\":" << r.left << ",\\"y\\":" << r.top << ",\\"width\\":" << r.right-r.left << ",\\"height\\":" << r.bottom-r.top << ",\\"minimized\\":" << (IsIconic(h)?"true":"false") << "}" << std::endl; return 0;
    }
    CaptureConfig config;`)
replace('    int fps = 60;', '    int cropX = 0, cropY = 0, cropW = 0, cropH = 0;\n    std::string systemPath, micPath;\n    int fps = 60;')
replace('    config.recordingId =', '    config.cropX = findInt(json, "cropX", 0);\n    config.cropY = findInt(json, "cropY", 0);\n    config.cropW = findInt(json, "cropW", 0);\n    config.cropH = findInt(json, "cropH", 0);\n    config.systemPath = findString(json, "systemPath");\n    config.micPath = findString(json, "micPath");\n    config.recordingId =')
replace('    int width = session.captureWidth();\n    int height = session.captureHeight();', `    int width = config.cropW > 0 ? config.cropW : session.captureWidth();
    int height = config.cropH > 0 ? config.cropH : session.captureHeight();
    if (config.cropX < 0 || config.cropY < 0 || width < 2 || height < 2 || config.cropX + width > session.captureWidth() || config.cropY + height > session.captureHeight()) {
        std::cerr << "ERROR: Crop is outside capture source" << std::endl; return 1;
    }
    width = (width / 2) * 2; height = (height / 2) * 2;
    std::cout << "{\\"event\\":\\"ta-size\\",\\"width\\":" << width << ",\\"height\\":" << height << "}" << std::endl;`)
replace('audioFormat ? &encoderAudioFormat : nullptr,', 'nullptr, // Ta stores independent WAV sidecars; the screen remains silent.')
replace('desc.BindFlags = 0;', 'desc.Width = width; desc.Height = height;\n                            desc.BindFlags = 0;')
replace('session.context()->CopyResource(latestFrameTexture.Get(), wgcTexture);', `D3D11_TEXTURE2D_DESC currentDesc{}; wgcTexture->GetDesc(&currentDesc);
                        if (currentDesc.Width < static_cast<UINT>(config.cropX + width) || currentDesc.Height < static_cast<UINT>(config.cropY + height)) {
                            std::cout << "{\\"event\\":\\"source-unavailable\\"}" << std::endl;
                            control.setPaused(true); continue;
                        }
                        D3D11_BOX box{static_cast<UINT>(config.cropX), static_cast<UINT>(config.cropY), 0, static_cast<UINT>(config.cropX + width), static_cast<UINT>(config.cropY + height), 1};
                        session.context()->CopySubresourceRegion(latestFrameTexture.Get(), 0, 0, 0, 0, wgcTexture, 0, &box);`)
replace('session.context()->CopyResource(latestFrameTexture.Get(), texture);', 'D3D11_BOX box{static_cast<UINT>(config.cropX), static_cast<UINT>(config.cropY), 0, static_cast<UINT>(config.cropX + width), static_cast<UINT>(config.cropY + height), 1};\n            session.context()->CopySubresourceRegion(latestFrameTexture.Get(), 0, 0, 0, 0, texture, 0, &box);')
const begin = source.indexOf('    std::unique_ptr<AudioMixer> audioMixer;')
const end = source.indexOf('    if (!startAudioCaptures())', begin)
if (begin < 0 || end < 0) throw new Error('Missing audio section')
source = source.slice(0,begin) + `    std::unique_ptr<AudioMixer> audioMixer, systemMixer;
    TaWaveWriter micFile, systemFile;
    auto startAudioCaptures = [&]() -> bool {
        if (!audioFormat) return true;
        if (config.captureMic) {
            if (!micFile.open(utf8ToWide(config.micPath), encoderAudioFormat)) return false;
            audioMixer = std::make_unique<AudioMixer>(encoderAudioFormat, encoderAudioFormat, microphoneAudioFormat,
                false, true, config.microphoneGain, [&](const BYTE* data, DWORD bytes, int64_t, int64_t) { if(!micFile.write(data, bytes)){encodeFailed=true;control.requestStop();return false;}return true; });
            if (!audioMixer->start() || !microphoneCapture.start([&](const BYTE* data, DWORD bytes, int64_t, int64_t) {
                if (!control.stopRequested && audioMixer) audioMixer->pushMicrophone(data, bytes);
            })) return false;
        }
        if (config.captureSystemAudio) {
            if (!systemFile.open(utf8ToWide(config.systemPath), encoderAudioFormat)) return false;
            systemMixer = std::make_unique<AudioMixer>(encoderAudioFormat, systemAudioFormat, encoderAudioFormat,
                true, false, 1.0, [&](const BYTE* data, DWORD bytes, int64_t, int64_t) { if(!systemFile.write(data, bytes)){encodeFailed=true;control.requestStop();return false;}return true; });
            if (!systemMixer->start() || !loopbackCapture.start([&](const BYTE* data, DWORD bytes, int64_t, int64_t) {
                if (!control.stopRequested && systemMixer) systemMixer->pushSystem(data, bytes);
            })) return false;
        }
        return true;
    };
\n` + source.slice(end)
replace('audioMixer->stop();', 'audioMixer->stop();')
// System mixer must also be stopped on every path; its destructor is an additional guard.
source = source.replaceAll('if (audioMixer) {', 'if (systemMixer) { systemMixer->stop(); }\n        if (audioMixer) {')
source = source.replace('if (systemMixer) { systemMixer->stop(); }\n        if (audioMixer) {\n            audioMixer->setPaused(isPaused);', 'if (systemMixer) systemMixer->setPaused(isPaused);\n        if (audioMixer) {\n            audioMixer->setPaused(isPaused);')
source = source.replace('if (systemMixer) { systemMixer->stop(); }\n        if (audioMixer) {\n        audioMixer->beginTimeline();', 'if (systemMixer) systemMixer->beginTimeline();\n    if (audioMixer) {\n        audioMixer->beginTimeline();')
replace('    const bool screenFinalized = encoder.finalize();', '    micFile.close(); systemFile.close();\n    const bool screenFinalized = encoder.finalize();')
fs.writeFileSync(path.resolve(__dirname, '../native/openscreen-wgc/src/main.cpp'), source)
let wgc = execFileSync('git', ['-C', upstream, 'show', `${ref}:electron/native/wgc-capture/src/wgc_session.cpp`], { encoding: 'utf8' })
wgc = wgc.replace(/\w+\.IsBorderRequired\(false\);/g, '// Ta: the Windows 19041 SDK lacks this optional API; keep the OS capture indicator.')
fs.writeFileSync(path.resolve(__dirname, '../native/openscreen-wgc/src/wgc_session.cpp'), wgc)

require('./adapt-window-resize.cjs')

require('./adapt-recording-resilience.cjs')
