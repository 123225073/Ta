#pragma once
#include <d3d11.h>
#include <wrl/client.h>
#include <atomic>
#include <algorithm>

// One asynchronous readback per second. DO_NOT_WAIT avoids blocking the encoder.
class TaFrameHealth {
    Microsoft::WRL::ComPtr<ID3D11Texture2D> staging_;
    bool pending_=false;ULONGLONG next_=0;
public:
    std::atomic<bool> black=false;
    void sample(ID3D11Device* device,ID3D11DeviceContext* context,ID3D11Texture2D* texture){
        if(!staging_){D3D11_TEXTURE2D_DESC d{};texture->GetDesc(&d);d.Usage=D3D11_USAGE_STAGING;d.BindFlags=0;d.MiscFlags=0;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;if(FAILED(device->CreateTexture2D(&d,nullptr,&staging_)))return;}
        if(pending_){D3D11_MAPPED_SUBRESOURCE m{};if(SUCCEEDED(context->Map(staging_.Get(),0,D3D11_MAP_READ,D3D11_MAP_FLAG_DO_NOT_WAIT,&m))){
            D3D11_TEXTURE2D_DESC d{};staging_->GetDesc(&d);int total=0,dark=0;
            for(UINT y=0;y<d.Height;y+=std::max(1u,d.Height/36))for(UINT x=0;x<d.Width;x+=std::max(1u,d.Width/64)){const auto p=static_cast<const BYTE*>(m.pData)+y*m.RowPitch+x*4;total++;if(p[0]<16&&p[1]<16&&p[2]<16)dark++;}
            black=dark>total*.985;context->Unmap(staging_.Get(),0);pending_=false;next_=GetTickCount64()+1000;
        }}else if(GetTickCount64()>=next_){context->CopyResource(staging_.Get(),texture);pending_=true;}
    }
};
inline void taPcmPeak(std::atomic<int>& peak,const BYTE* data,DWORD bytes){
    int value=0;const auto samples=reinterpret_cast<const int16_t*>(data);
    for(DWORD i=0;i<bytes/2;i++)value=std::max(value,std::abs(int(samples[i])));
    int before=peak.load();while(before<value&&!peak.compare_exchange_weak(before,value)){}
}
