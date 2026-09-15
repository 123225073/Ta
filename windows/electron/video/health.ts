export interface CaptureHealth { frames:number; black:boolean; videoAgeMs:number; systemPeak:number; micPeak:number }
/** Suspicion, not a claim that a quiet meeting or a dark slide is broken. */
export class RecordingHealth {
  private blackSince=0; private silentSince=0; private alerted=new Map<string,number>();
  reset(){this.blackSince=0;this.silentSince=0;this.alerted.clear()}
  check(h:CaptureHealth,now:number,system:boolean,mic:boolean){
    this.blackSince=h.black?(this.blackSince||now):0;
    this.silentSince=(system||mic)&&(!system||h.systemPeak<.0001)&&(!mic||h.micPeak<.0001)?(this.silentSince||now):0;
    const issues:string[]=[];
    if(h.videoAgeMs>=8000)issues.push('画面采集超过 8 秒没有更新，可能已失去录制源');
    else if(this.blackSince&&now-this.blackSince>=4000)issues.push('已连续约 5 秒检测到黑画面');
    if(this.silentSince&&now-this.silentSince>=29000)issues.push('已连续约 30 秒未检测到所选音轨的声音，请核对会议输出设备和静音状态');
    return issues.filter(s=>{if(now-(this.alerted.get(s)??-Infinity)<60000)return false;this.alerted.set(s,now);return true})
  }
}
