#pragma once
#include "mf_encoder.h"
#include <fstream>
#include <filesystem>
#include <array>
#include <cstring>
// Ta: independently recoverable PCM sidecars. AudioMixer supplies continuous,
// pause-free samples, including silence. Header is refreshed every second.
class TaWaveWriter {
    std::ofstream file;
    AudioInputFormat format{};
    uint32_t bytes = 0, checkpoint = 0;
    void header() {
        std::array<char,44> h{};
        auto u16 = [&](int p, uint16_t n) { std::memcpy(h.data()+p, &n, 2); };
        auto u32 = [&](int p, uint32_t n) { std::memcpy(h.data()+p, &n, 4); };
        std::memcpy(h.data(), "RIFF",4); u32(4,36+bytes); std::memcpy(h.data()+8,"WAVEfmt ",8); u32(16,16);
        u16(20, format.subtype == MFAudioFormat_Float ? 3 : 1); u16(22,static_cast<uint16_t>(format.channels));
        u32(24,format.sampleRate); u32(28,format.avgBytesPerSec); u16(32,static_cast<uint16_t>(format.blockAlign));
        u16(34,static_cast<uint16_t>(format.bitsPerSample)); std::memcpy(h.data()+36,"data",4); u32(40,bytes);
        file.seekp(0); file.write(h.data(),44); file.flush(); file.seekp(44ULL+bytes);
    }
public:
    bool open(const std::wstring& name, AudioInputFormat f) { format=f; file.open(std::filesystem::path(name),std::ios::binary|std::ios::trunc); if(!file) return false; header(); return true; }
    bool write(const BYTE* data, DWORD count) { if(count > 0xfffffff0ULL-44-bytes) return false; file.write(reinterpret_cast<const char*>(data),count); bytes+=count; if(bytes-checkpoint >= format.avgBytesPerSec) { header(); checkpoint=bytes; } return file.good(); }
    void close() { if(file.is_open()) { header(); file.close(); } }
    ~TaWaveWriter() { close(); }
};
