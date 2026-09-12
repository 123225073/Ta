import type { ExportProgress, Mark, RecordingOptions, RecordingSource, RecordingState, VideoProject, VideoSettings } from '../../../electron/video/model'
export type * from '../../../electron/video/model'
declare global {
  interface Window { taVideo: {
    open(): Promise<void>; init(): Promise<{state:RecordingState;settings:VideoSettings;theme:string}>;
    closeReady():Promise<void>;onClosing(fn:()=>void):()=>void;
    sources():Promise<RecordingSource[]>; microphones():Promise<string[]>; list():Promise<VideoProject[]>;
    get(id:string):Promise<VideoProject>; save(id:string,p:VideoProject):Promise<VideoProject>;
    start(o:RecordingOptions):Promise<string>;pause(p:boolean):Promise<void>;stop():Promise<void>;
    ink():Promise<void>;mark(m:Mark):Promise<void>;clear():Promise<void>;undoMark():Promise<void>;
    settings(s:Partial<VideoSettings>):Promise<VideoSettings>;chooseRoot():Promise<VideoSettings>;folder(id?:string):Promise<void>;
    export(id:string,height:number):Promise<string|undefined>;cancelExport():Promise<void>;
    onState(fn:(s:RecordingState)=>void):()=>void;onFinished(fn:(id:string)=>void):()=>void;onExport(fn:(p:ExportProgress)=>void):()=>void;
  } }
}
export const media=(id:string,name:string)=>`ta-video://media/${id}/${name}`
export const clockText=(t:number)=>`${Math.floor(t/60000).toString().padStart(2,'0')}:${Math.floor(t/1000%60).toString().padStart(2,'0')}`
