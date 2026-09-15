#pragma once
#include <d3d11.h>
#include <wrl/client.h>
#include <algorithm>
#include <cmath>
#include <iostream>

// Fit a changing WGC window into the encoder's fixed canvas, without cropping.
// All calls run on the capture/encode thread using its existing D3D device.
class TaWindowFit {
    Microsoft::WRL::ComPtr<ID3D11VideoDevice> device_;
    Microsoft::WRL::ComPtr<ID3D11VideoContext> context_;
    Microsoft::WRL::ComPtr<ID3D11VideoProcessorEnumerator> enumerator_;
    Microsoft::WRL::ComPtr<ID3D11VideoProcessor> processor_;
    int w_=0,h_=0;
public:
    bool copy(ID3D11Device* device, ID3D11DeviceContext* context, ID3D11Texture2D* input, ID3D11Texture2D* output, int width, int height, int outW, int outH, int x=0, int y=0, int cropW=0, int cropH=0) {
        if ((!device_ || !context_) && (FAILED(device->QueryInterface(IID_PPV_ARGS(&device_))) || FAILED(context->QueryInterface(IID_PPV_ARGS(&context_))))) return false;
        if (!processor_ || w_!=width || h_!=height) {
            processor_.Reset(); enumerator_.Reset();
            D3D11_VIDEO_PROCESSOR_CONTENT_DESC desc{};
            desc.InputFrameFormat=D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
            desc.InputWidth=width;desc.InputHeight=height;desc.OutputWidth=outW;desc.OutputHeight=outH;
            desc.InputFrameRate={30,1};desc.OutputFrameRate={30,1};desc.Usage=D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
            if(FAILED(device_->CreateVideoProcessorEnumerator(&desc,&enumerator_)) || FAILED(device_->CreateVideoProcessor(enumerator_.Get(),0,&processor_))) return false;
            w_=width;h_=height;
        }
        Microsoft::WRL::ComPtr<ID3D11VideoProcessorInputView> inView;
        Microsoft::WRL::ComPtr<ID3D11VideoProcessorOutputView> outView;
        D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inDesc{};inDesc.ViewDimension=D3D11_VPIV_DIMENSION_TEXTURE2D;
        D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outDesc{};outDesc.ViewDimension=D3D11_VPOV_DIMENSION_TEXTURE2D;
        const HRESULT inResult=device_->CreateVideoProcessorInputView(input,enumerator_.Get(),&inDesc,&inView),outResult=device_->CreateVideoProcessorOutputView(output,enumerator_.Get(),&outDesc,&outView);
        if(FAILED(inResult)||FAILED(outResult)){std::cerr<<"Window fit views "<<std::hex<<inResult<<" "<<outResult<<std::dec<<" size "<<width<<"x"<<height<<std::endl;return false;}
        const int sw=cropW>0?cropW:width,sh=cropH>0?cropH:height;
        if(x<0||y<0||x+sw>width||y+sh>height)return false;
        const double scale=std::min(double(outW)/sw,double(outH)/sh);
        const int fitW=std::max(1,int(std::round(sw*scale))),fitH=std::max(1,int(std::round(sh*scale)));
        RECT source{x,y,x+sw,y+sh},dest{(outW-fitW)/2,(outH-fitH)/2,(outW-fitW)/2+fitW,(outH-fitH)/2+fitH},target{0,0,outW,outH};
        D3D11_VIDEO_COLOR black{};black.RGBA.A=1;
        context_->VideoProcessorSetOutputBackgroundColor(processor_.Get(),FALSE,&black);
        context_->VideoProcessorSetOutputTargetRect(processor_.Get(),TRUE,&target);
        context_->VideoProcessorSetStreamFrameFormat(processor_.Get(),0,D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
        context_->VideoProcessorSetStreamAutoProcessingMode(processor_.Get(),0,FALSE);
        context_->VideoProcessorSetStreamSourceRect(processor_.Get(),0,TRUE,&source);
        context_->VideoProcessorSetStreamDestRect(processor_.Get(),0,TRUE,&dest);
        D3D11_VIDEO_PROCESSOR_STREAM stream{};stream.Enable=TRUE;stream.pInputSurface=inView.Get();
        const HRESULT result=context_->VideoProcessorBlt(processor_.Get(),outView.Get(),0,1,&stream);
        if(FAILED(result))std::cerr<<"Window fit blit "<<std::hex<<result<<std::dec<<" size "<<width<<"x"<<height<<std::endl;
        return SUCCEEDED(result);
    }
};
