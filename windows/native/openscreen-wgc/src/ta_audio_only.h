// Included after Ta's capture config/command helpers. No WGC or video encoder.
int taRecordAudio(const CaptureConfig& config) {
    if(!config.captureMic&&!config.captureSystemAudio){std::cerr<<"Select an audio input"<<std::endl;return 1;}
    CaptureControl control;
    WasapiLoopbackCapture mic, system;
    if(config.captureMic&&!mic.initializeMicrophone(utf8ToWide(config.microphoneDeviceId),utf8ToWide(config.microphoneDeviceName)))return 1;
    if(config.captureSystemAudio&&!system.initializeSystemLoopback())return 1;
    const auto format=makeAacCompatibleAudioFormat(config.captureMic?mic.inputFormat():system.inputFormat());
    TaWaveWriter micFile,systemFile;
    if(config.captureMic&&!micFile.open(utf8ToWide(config.micPath),format))return 1;
    if(config.captureSystemAudio&&!systemFile.open(utf8ToWide(config.systemPath),format))return 1;
    std::atomic<int> micPeak{0},systemPeak{0};std::atomic<bool> failed{false};
    auto output=[&](TaWaveWriter& file,std::atomic<int>& peak,const BYTE* data,DWORD bytes){taPcmPeak(peak,data,bytes);if(!file.write(data,bytes)){failed=true;control.requestStop();return false;}return true;};
    AudioMixer micMixer(format,format,mic.inputFormat(),false,config.captureMic,1.0,[&](const BYTE* d,DWORD b,int64_t,int64_t){return output(micFile,micPeak,d,b);});
    AudioMixer systemMixer(format,system.inputFormat(),format,config.captureSystemAudio,false,1.0,[&](const BYTE* d,DWORD b,int64_t,int64_t){return output(systemFile,systemPeak,d,b);});
    auto startFailed=[&]{mic.stop();system.stop();micMixer.stop();systemMixer.stop();return 1;};
    if(config.captureMic&&(!micMixer.start()||!mic.start([&](const BYTE* d,DWORD b,int64_t,int64_t){micMixer.pushMicrophone(d,b);})))return startFailed();
    if(config.captureSystemAudio&&(!systemMixer.start()||!system.start([&](const BYTE* d,DWORD b,int64_t,int64_t){systemMixer.pushSystem(d,b);})))return startFailed();
    if(config.captureMic)micMixer.beginTimeline();if(config.captureSystemAudio)systemMixer.beginTimeline();
    std::cout<<"{\"event\":\"recording-started\"}"<<std::endl;
    std::thread commands([&]{readCaptureCommands(control,[&](bool paused){micMixer.setPaused(paused);systemMixer.setPaused(paused);});});
    while(!control.stopRequested){
        {std::unique_lock lock(control.stopMutex);control.stopCv.wait_for(lock,std::chrono::seconds(1),[&]{return control.stopRequested.load();});}
        if(control.stopRequested)break;
        if((config.captureMic&&mic.needsReconnect())||(config.captureSystemAudio&&system.needsReconnect())){
            // Stop visibly and preserve this take rather than silently record an unplugged device.
            std::cout<<"{\"event\":\"audio-error\"}"<<std::endl;failed=true;control.requestStop();break;
        }
        std::cout<<"{\"event\":\"capture-health\",\"frames\":0,\"black\":false,\"videoAgeMs\":0,\"micPeak\":"<<micPeak.exchange(0)/32768.0<<",\"systemPeak\":"<<systemPeak.exchange(0)/32768.0<<"}"<<std::endl;
    }
    mic.stop();system.stop();micMixer.stop();systemMixer.stop();micFile.close();systemFile.close();
    if(commands.joinable()){if(failed)CancelSynchronousIo(commands.native_handle());commands.join();}
    return failed?1:0;
}
